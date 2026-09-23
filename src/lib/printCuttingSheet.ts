import type jsPDFType from 'jspdf';
import type { TakenOrder } from '@/lib/ordersApi';

/*
 * Библиотеки для PDF (jspdf, html2canvas, qrcode) весят вместе больше 400 КБ и нужны
 * ТОЛЬКО в момент печати листа закройщика. Раньше они грузились при каждом открытии
 * страницы «Товары для пошива» — страница открывалась долго, хотя печатают редко.
 * Теперь подгружаем их в момент нажатия на печать.
 */

/**
 * Печать "листа закройщика" по взятому стеку заказов — генерирует один PDF-файл из
 * ДВУХ документов подряд:
 *   1) чек-лист для закройщика (материал+размер крупно, маркетплейс+номер заказа мелко,
 *      пустой квадратик справа для галочки) — закройщик отмечает раскроенные позиции
 *   2) лист с QR-кодами под нарезку — те же позиции, но с QR-кодом (зашит номер заказа
 *      как есть) вместо квадратика; лист режется на отдельные бирки и крепится к ткани
 * Заказы группируются по материалу (одинаковый материал идёт подряд без разрыва), чтобы
 * закройщик раскраивал одним куском ткани не переключаясь между рулонами.
 */

const A4_WIDTH_PX = 794; // A4 при 96dpi
const A4_HEIGHT_PX = 1123;
const COLS = 2;
const PAGE_PADDING_PX = 12;
/** Поля печати в мм. Принтер физически не печатает по самому краю листа: при отрисовке
 * PDF «в обрез» (0,0,210,297) рамки крайних ячеек и таблички ID срезались, а картинка
 * выглядела съехавшей. Печатаем с полем и сохраняем пропорции A4-макета. */
const PDF_MARGIN_MM = 6;
/** Отступ между блоками разных материалов. */
const GROUP_GAP_PX = 4;
// Высота ячейки: в неё должны помещаться материал+размер, номер заказа, маркетплейс
// и до трёх меток (связка, покупка OZON, оверлок) — при 79px нижние метки обрезались.
//
// Раньше шрифт номера был 11px: швея не могла прочитать его на вешалке, не поднося
// лист к глазам. Кегли увеличены вдвое; число позиций на листе теперь считается по
// реальной высоте сетки, а не жёстко «20 штук».
const CELL_HEIGHT_PX = 92;
// QR печатается ВНУТРИ рамки, поэтому он должен быть заметно меньше её высоты:
// иначе картинка упирается в границы и вылезает за рамку соседней колонки.
//
// На эту же ширину слева отступает текст: без отступа он центрировался по всей
// ячейке и наезжал на QR — казалось, что надпись сдвинута вправо и висит криво.
const QR_SIZE_PX = 64;

/** Дата листа — всегда московская.
 *
 * Раньше брали дату устройства: планшет в цехе с чужим часовым поясом или
 * неверными настройками печатал вчерашнее число, и листы за смену расходились
 * с отчётами. Производство живёт по московскому времени — его и печатаем. */
const MSK_TZ = 'Europe/Moscow';

const formatToday = () =>
  new Date().toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: MSK_TZ,
  });

/** Время печати листа (МСК) — по нему видно, когда закройщица взяла работу.
 * Нужно при разборе: на вешалке лежат крои с разных листов одной смены. */
const formatNowTime = () =>
  new Date().toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: MSK_TZ,
  });

/** Группирует заказы по материалу, сохраняя порядок первого появления материала. Внутри
 * материала вещи одной связки Яндекса идут подряд и по порядку — их вешают на одну вешалку,
 * поэтому в листе они не должны перемешиваться с другими заказами. */
const groupByMaterial = (orders: TakenOrder[]): TakenOrder[] => {
  const groups = new Map<string, TakenOrder[]>();
  for (const o of orders) {
    const key = o.material || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const ga = a.groupKey || '';
      const gb = b.groupKey || '';
      if (ga !== gb) return ga.localeCompare(gb);
      return (a.groupPosition || 0) - (b.groupPosition || 0);
    });
  }
  return Array.from(groups.values()).flat();
};

/** Подпись связки в позиции листа: «СВЯЗКА 3/32 — одна вешалка». */
const groupNote = (o: TakenOrder) =>
  o.groupSize && o.groupSize > 1
    ? `<div style="margin-top:1px;font-size:10px;font-weight:800;white-space:nowrap;
                    line-height:1;">СВЯЗКА ${o.groupPosition}/${o.groupSize} — ОДНА ВЕШАЛКА</div>`
    : '';

/**
 * Метка «ОДНА ПОКУПКА» — отправления одного покупателя OZON.
 *
 * Покупатель заказал две одинаковые шторы: приходят два РАЗНЫХ отправления со
 * своими ярлыками. Отгружаются они порознь, поэтому вешать их вместе, как связку
 * Яндекса, нельзя — но вещи одинаковые, и на вешалке их не различить.
 *
 * Именно так потерялся заказ 87011164-0186-1: два одинаковых Лена 300×255 из одной
 * покупки легли на вешалку 1, и швеи час выясняли, где чей крой. Метка предупреждает
 * закройщицу заранее: вещи похожи, бирки путать нельзя.
 */
const purchaseNote = (o: TakenOrder) =>
  o.purchaseSize && o.purchaseSize > 1
    ? `<div style="margin-top:1px;font-size:10px;font-weight:900;white-space:nowrap;
                   line-height:1.15;border:2px solid #000;border-radius:2px;
                   padding:0 3px;display:inline-block;align-self:center;">1 ПОКУПАТЕЛЬ ${
                     o.purchasePosition
                   }/${o.purchaseSize} — НЕ ПУТАТЬ</div>`
    : '';

/**
 * Метка «ОВЕРЛОК» на листе закройщика.
 *
 * Такую вещь после раскроя вешают не в общую очередь на прямострочку, а в очередь
 * обмётки края. Закройщик должен видеть это в момент работы — на бумаге, а не в
 * телефоне: иначе крой уедет не туда, и вещь вернётся с середины конвейера.
 * Печатается инверсией (белым по чёрному) — на плотном листе с двумя десятками
 * позиций обычная строка теряется.
 */
const overlockNote = (o: TakenOrder) =>
  o.requiresOverlock
    ? `<div style="margin-top:1px;font-size:11px;font-weight:900;white-space:nowrap;
                   line-height:1.15;background:#000;color:#fff;border-radius:2px;
                   padding:0 4px;display:inline-block;align-self:center;">ОВЕРЛОК</div>`
    : '';

/* ------------------------------------------------------------------ *
 * Разбиение на страницы по РЕАЛЬНОЙ высоте сетки.
 *
 * Раньше лист резался жёстко по 20 позиций. Но блок материала всегда занимает
 * целые ряды: материал с одной позицией съедает ряд целиком (вторая половина
 * ряда пустая), а между блоками ещё и отступ. При нескольких таких материалах
 * сетка вырастала выше листа A4, нижние позиции уезжали за край и обрезались
 * `overflow:hidden` — заказ просто не попадал на лист закройщика.
 *
 * Теперь считаем высоту: шапка + баннеры + ряды каждого блока, и переносим на
 * следующую страницу то, что не влезло.
 * ------------------------------------------------------------------ */

/** Полезная высота страницы под шапку и сетку. */
const CONTENT_HEIGHT_PX = A4_HEIGHT_PX - PAGE_PADDING_PX * 2;
/** Шапка с фамилией и датой. */
const HEADER_HEIGHT_PX = 42;
/** Баннер связок (заголовок + перечисление). */
const GROUPS_BANNER_PX = 62;
/** Баннер покупок OZON — заголовок в две строки, поэтому выше. */
const PURCHASES_BANNER_PX = 82;

/** Высота всего, что стоит над сеткой на конкретной странице. */
const headerHeight = (pageOrders: TakenOrder[]) => {
  const hasGroups = pageOrders.some((o) => o.groupKey && o.groupSize && o.groupSize > 1);
  const hasPurchases = pageOrders.some((o) => o.purchaseKey && o.purchaseSize && o.purchaseSize > 1);
  return (
    HEADER_HEIGHT_PX + (hasGroups ? GROUPS_BANNER_PX : 0) + (hasPurchases ? PURCHASES_BANNER_PX : 0)
  );
};

/** Непрерывные блоки одного материала — в том порядке, в котором они лягут на лист. */
const materialBlocks = (orders: TakenOrder[]): TakenOrder[][] => {
  const blocks: TakenOrder[][] = [];
  let current: string | null = null;
  for (const o of orders) {
    const key = o.material || '—';
    if (key !== current || blocks.length === 0) blocks.push([]);
    current = key;
    blocks[blocks.length - 1].push(o);
  }
  return blocks;
};

/** Режет заказы на страницы так, чтобы сетка гарантированно влезала в лист A4. */
const paginate = (orders: TakenOrder[]): TakenOrder[][] => {
  const pages: TakenOrder[][] = [];
  let page: TakenOrder[] = [];
  let used = 0;
  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    used = 0;
  };
  // Высоту шапки берём по худшему случаю для всей пачки: баннер связок или покупок
  // может появиться на любой странице, и если считать его по уже набранным позициям,
  // сетка «подрастёт» задним числом и опять вылезет за край листа.
  const reserved = headerHeight(orders);
  for (const block of materialBlocks(orders)) {
    let rest = block;
    while (rest.length) {
      const available = CONTENT_HEIGHT_PX - reserved - used - GROUP_GAP_PX;
      let maxRows = Math.floor(available / CELL_HEIGHT_PX);
      if (maxRows < 1) {
        if (page.length) {
          flush();
          continue;
        }
        // На пустой странице ряд обязан поместиться всегда: иначе цикл «нечего
        // сбрасывать — нечего добавить» молча выбросил бы остаток заказов с листа.
        maxRows = 1;
      }
      const take = Math.min(rest.length, maxRows * COLS);
      page = [...page, ...rest.slice(0, take)];
      used += Math.ceil(take / COLS) * CELL_HEIGHT_PX + GROUP_GAP_PX;
      rest = rest.slice(take);
      if (rest.length) flush();
    }
  }
  flush();
  return pages;
};

const sizeLabel = (o: TakenOrder) => `${o.material || '—'} ${o.width ?? '—'} × ${o.height ?? '—'}`;

/** Сколько строк-меток (связка, покупка OZON, оверлок) висит под номером заказа.
 *
 * Каждая метка занимает строку в ячейке фиксированной высоты. Раньше учитывались
 * только две из трёх, и позиция с тремя метками обрезалась ровно посередине
 * предупреждения — закройщик читал «1 ПОКУПАТЕЛЬ 1/2 — НЕ ПУ». */
const noteLines = (o: TakenOrder) =>
  (o.groupSize && o.groupSize > 1 ? 1 : 0) +
  (o.purchaseSize && o.purchaseSize > 1 ? 1 : 0) +
  (o.requiresOverlock ? 1 : 0);

/** Ширина ячейки в сетке 2 колонки. */
const CELL_WIDTH_PX = (A4_WIDTH_PX - PAGE_PADDING_PX * 2) / COLS;

/** Кегль, при котором строка гарантированно влезает в одну строку по ширине.
 *
 * Раньше кегль подбирался по «длиннее 16 символов — уменьшить на 12%»: для
 * «Мрамор мятный 300 × 250» этого не хватало, строка переносилась и съезжала за
 * рамку. Считаем честно: у Arial Bold средняя ширина знака ≈ 0.6 кегля. */
const fitFont = (text: string, max: number, availWidth: number) => {
  const len = Math.max(text.length, 1);
  return Math.max(9, Math.min(max, Math.floor(availWidth / (len * 0.6))));
};

/** Базовый кегль строки: чем больше меток в ячейке, тем меньше места под текст.
 * Предупреждение важнее лишних пунктов кегля — оно должно быть видно целиком. */
const baseFont = (o: TakenOrder, max: number) => {
  const lines = noteLines(o);
  if (lines >= 3) return Math.round(max * 0.7);
  if (lines === 2) return Math.round(max * 0.78);
  if (lines === 1) return Math.round(max * 0.85);
  return max;
};

const sizeFont = (o: TakenOrder, max: number, availWidth: number) =>
  fitFont(sizeLabel(o), baseFont(o, max), availWidth);

/** То же для номера заказа: у WB он короткий, у OZON — длинный с дефисами. */
const numberFont = (o: TakenOrder, max: number, availWidth: number) =>
  fitFont(o.orderNumber || '', baseFont(o, max), availWidth);

// Ячейка одной позиции: слева крупно материал+размер и мелко маркетплейс+номер (+ID закройщика
// на QR-листе), справа узкая колонка (пустая — под галочку/крепление бирки), как в образце.
/** Ячейка одной позиции. Вещи связки выделяем жирной рамкой и серой заливкой: на листе
 * из 20 позиций закройщик должен видеть их с одного взгляда, а не вычитывать подписи. */
/** Табличка ID закройщика в правом углу ячейки.
 *
 * По этому номеру швея и бригадир понимают, кто раскроил вещь: на вешалке висит
 * десяток бирок от разных закройщиков, и разобрать их иначе невозможно. Раньше ID
 * печатался мелким шрифтом в общей строке с маркетплейсом — его не читали. */
const idBadge = (cutterId: number | null) =>
  cutterId == null
    ? ''
    : `<div style="border-left:2px solid #000;display:flex;flex-direction:column;
                   align-items:center;justify-content:center;line-height:1;">
         <div style="font-size:9px;font-weight:700;letter-spacing:0.5px;">ID</div>
         <div style="font-size:26px;font-weight:800;">${cutterId}</div>
       </div>`;

const cell = (inner: string, isGroup = false, cutterId: number | null = null) =>
  `<div style="display:grid;grid-template-columns:1fr${
    cutterId != null ? ' 52px' : ''
  };border:${
    isGroup ? '4px solid #000' : '2px solid #000'
  };box-sizing:border-box;height:${CELL_HEIGHT_PX}px;overflow:hidden;${
    isGroup ? 'background:#e8e8e8;' : ''
  }">
     ${inner}
     ${idBadge(cutterId)}
   </div>`;

/** Сетка позиций, сгруппированная по материалу: между группами материала — визуальный отступ. */
const groupedGrid = (
  pageOrders: TakenOrder[],
  renderInner: (o: TakenOrder) => string,
  cutterId: number | null = null
) => {
  const blocks: string[] = [];
  let current: string | null = null;
  let rows: string[] = [];
  const flush = () => {
    if (rows.length) {
      blocks.push(`<div style="display:grid;grid-template-columns:1fr 1fr;">${rows.join('')}</div>`);
      rows = [];
    }
  };
  for (const o of pageOrders) {
    const key = o.material || '—';
    if (current !== null && key !== current) flush();
    current = key;
    rows.push(cell(renderInner(o), !!(o.groupSize && o.groupSize > 1), cutterId));
  }
  flush();
  return `<div style="display:flex;flex-direction:column;gap:${GROUP_GAP_PX}px;">${blocks.join(
    ''
  )}</div>`;
};

const page = (inner: string) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:${PAGE_PADDING_PX}px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">${inner}</div>`;

const buildChecklistPageHtml = (
  pageOrders: TakenOrder[],
  cutterName: string,
  date: string,
  cutterId: number | null = null
) => {
  // Сводка связок на странице: заказ покупателя из нескольких вещей вешается на ОДНУ вешалку
  // целиком, иначе швея не сможет взять и отшить его одним куском.
  const groupCounts = new Map<string, number>();
  for (const o of pageOrders) {
    if (o.groupKey && o.groupSize && o.groupSize > 1) {
      groupCounts.set(o.groupKey, (groupCounts.get(o.groupKey) || 0) + 1);
    }
  }
  const groupsBanner = groupCounts.size
    ? `<div style="border:3px solid #000;background:#e8e8e8;padding:5px 10px;margin-bottom:6px;font-weight:800;">
         <div style="font-size:15px;">НА ЛИСТЕ ЕСТЬ СВЯЗКИ — ВЕШАТЬ ВМЕСТЕ НА ОДНУ ВЕШАЛКУ</div>
         <div style="font-size:12px;margin-top:2px;">
           ${Array.from(groupCounts.entries())
             .map(([key, cnt]) => `${key} — ${cnt} шт.`)
             .join(' &nbsp;·&nbsp; ')}
         </div>
       </div>`
    : '';

  // Сводка покупок OZON: два отправления одного покупателя — это, как правило, две
  // ОДИНАКОВЫЕ вещи. Отгружаются они порознь (у каждой свой ярлык), поэтому вешать
  // надо на РАЗНЫЕ вешалки, а бирки не перепутать. Предупреждаем сверху, чтобы
  // закройщица увидела это до раскроя, а не искала потом вещь на вешалке.
  const purchaseCounts = new Map<string, number>();
  for (const o of pageOrders) {
    if (o.purchaseKey && o.purchaseSize && o.purchaseSize > 1) {
      purchaseCounts.set(o.purchaseKey, (purchaseCounts.get(o.purchaseKey) || 0) + 1);
    }
  }
  const purchasesBanner = purchaseCounts.size
    ? `<div style="border:3px solid #000;padding:5px 10px;margin-bottom:6px;font-weight:800;">
         <div style="font-size:15px;">ОДИН ПОКУПАТЕЛЬ — НЕСКОЛЬКО ВЕЩЕЙ. ВЕЩИ ПОХОЖИ,
           БИРКИ НЕ ПУТАТЬ, ВЕШАТЬ НА РАЗНЫЕ ВЕШАЛКИ</div>
         <div style="font-size:12px;margin-top:2px;">
           ${Array.from(purchaseCounts.entries())
             .map(([key, cnt]) => `${key} — ${cnt} шт.`)
             .join(' &nbsp;·&nbsp; ')}
         </div>
       </div>`
    : '';

  const header = `
    <div style="display:flex;justify-content:space-between;align-items:stretch;margin-bottom:8px;">
      <div style="border:2px solid #000;padding:4px 12px;font-size:16px;font-weight:800;">${cutterName}</div>
      <div style="border:2px solid #000;padding:4px 12px;font-size:16px;font-weight:800;">
        ${date} ${formatNowTime()}
      </div>
    </div>` + groupsBanner + purchasesBanner;
  // Полезная ширина текста: ячейка минус табличка ID и внутренние отступы.
  const textWidth = CELL_WIDTH_PX - (cutterId != null ? 52 : 0) - 24;
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="padding:4px 10px;text-align:center;display:flex;flex-direction:column;
                  justify-content:center;height:100%;box-sizing:border-box;overflow:hidden;">
        <div style="font-size:${sizeFont(o, 23, textWidth)}px;
                    font-weight:800;line-height:1.05;white-space:nowrap;">${sizeLabel(o)}</div>
        <div style="font-size:${numberFont(o, 23, textWidth)}px;
                    font-weight:800;margin-top:2px;letter-spacing:0.3px;white-space:nowrap;
                    line-height:1.1;">${o.orderNumber}</div>
        <div style="font-size:${noteLines(o) ? 9 : 11}px;font-weight:700;
                    color:#222;margin-top:1px;line-height:1;">${o.marketplace}</div>
        ${groupNote(o)}
        ${purchaseNote(o)}
        ${overlockNote(o)}
      </div>`,
    cutterId
  );
  return page(header + grid);
};

const buildQrPageHtml = (
  pageOrders: TakenOrder[],
  qrDataUrls: Record<number, string>,
  cutterId: number | null
) => {
  // На QR-листе текст стоит справа от кода, поэтому доступной ширины заметно меньше,
  // чем в чек-листе: без этого вычитания строка наезжала на QR и на рамку.
  const textWidth = CELL_WIDTH_PX - (cutterId != null ? 52 : 0) - QR_SIZE_PX - 20;
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="position:relative;height:100%;box-sizing:border-box;overflow:hidden;
                  padding:4px 6px 4px ${QR_SIZE_PX + 10}px;
                  display:flex;flex-direction:column;justify-content:center;text-align:center;">
        <img src="${qrDataUrls[o.id]}"
             style="position:absolute;left:5px;top:50%;transform:translateY(-50%);
                    width:${QR_SIZE_PX}px;height:${QR_SIZE_PX}px;" />
        <div style="font-size:${sizeFont(o, 20, textWidth)}px;font-weight:800;line-height:1.05;
                    white-space:nowrap;">${sizeLabel(o)}</div>
        <div style="font-size:${numberFont(o, 20, textWidth)}px;font-weight:800;margin-top:2px;
                    white-space:nowrap;line-height:1.1;">${o.orderNumber}</div>
        <div style="font-size:10px;font-weight:700;color:#222;margin-top:1px;line-height:1;">
          ${o.marketplace} [${o.orderType}]
        </div>
        ${groupNote(o)}
        ${purchaseNote(o)}
        ${overlockNote(o)}
      </div>`,
    cutterId
  );
  return page(grid);
};

const renderPageToPdf = async (pdf: jsPDFType, html: string, isFirstPage: boolean) => {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(container.firstElementChild as HTMLElement, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    if (!isFirstPage) pdf.addPage();
    // Вписываем макет в лист с полями, СОХРАНЯЯ пропорции: раньше картинка растягивалась
    // на все 210×297 мм, и рамки по краям срезал принтер, а текст выглядел сплюснутым.
    const maxW = 210 - PDF_MARGIN_MM * 2;
    const maxH = 297 - PDF_MARGIN_MM * 2;
    const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    pdf.addImage(imgData, 'PNG', (210 - w) / 2, (297 - h) / 2, w, h);
  } finally {
    document.body.removeChild(container);
  }
};

/**
 * Куда отправить готовый лист.
 *
 * 'download' — сохранить PDF файлом. Так работает компьютер закройщицы: файл
 *   остаётся на диске, его можно открыть и распечатать когда удобно.
 * 'print'    — сразу открыть диалог печати, файл никуда не сохранять. Режим
 *   терминала в цехе: на планшете скачанный PDF надо ещё найти в загрузках и
 *   открыть сторонней читалкой — закройщица до принтера так и не доходит.
 */
export type CuttingSheetMode = 'download' | 'print';

/** Отправить готовый PDF на принтер через скрытый iframe — без новых вкладок.
 *
 * Планшет в киоске открывает вкладку поверх терминала, и сотрудник теряет из
 * виду экран; всплывающие окна к тому же часто блокируются браузером. Здесь
 * документ живёт в невидимом iframe текущей страницы: браузер показывает
 * обычный диалог печати, а терминал остаётся на том же месте. */
const sendPdfToPrinter = (pdf: jsPDFType) => {
  pdf.autoPrint();
  const url = pdf.output('bloburl') as unknown as string;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = url;
  document.body.appendChild(iframe);
  // Убираем iframe не сразу: пока открыт диалог печати, документ должен жить.
  // Минута с запасом — дольше диалог не висит, а держать мусор в DOM незачем.
  setTimeout(() => {
    iframe.remove();
    URL.revokeObjectURL(url);
  }, 60000);
};

export const printCuttingSheet = async (
  orders: TakenOrder[],
  cutterName: string,
  cutterId: number | null = null,
  mode: CuttingSheetMode = 'download'
) => {
  if (orders.length === 0) return;

  const grouped = groupByMaterial(orders);
  // Чек-лист и лист с QR режутся ОДНОЙ и той же разбивкой: иначе позиции на
  // страницах разъедутся, и бирку не найти напротив строки чек-листа.
  const pages = paginate(grouped);
  const date = formatToday();

  // Подгружаем тяжёлые библиотеки только сейчас — когда печать действительно нужна.
  const [{ default: jsPDF }, { default: QRCode }] = await Promise.all([
    import('jspdf'),
    import('qrcode'),
  ]);

  const qrEntries = await Promise.all(
    grouped.map(async (o) => [o.id, await QRCode.toDataURL(o.orderNumber, { width: 120, margin: 1 })] as const)
  );
  const qrDataUrls = Object.fromEntries(qrEntries) as Record<number, string>;

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  let isFirstPage = true;
  for (const pageOrders of pages) {
    await renderPageToPdf(
      pdf,
      buildChecklistPageHtml(pageOrders, cutterName, date, cutterId),
      isFirstPage
    );
    isFirstPage = false;
  }
  for (const pageOrders of pages) {
    await renderPageToPdf(pdf, buildQrPageHtml(pageOrders, qrDataUrls, cutterId), isFirstPage);
    isFirstPage = false;
  }

  if (mode === 'print') {
    sendPdfToPrinter(pdf);
    return;
  }

  pdf.save(`Лист закройщика ${date.replace(/\//g, '-')}.pdf`);
};