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

/* СТЕК ЗАКРОЙЩИКА — 20 ПОЗИЦИЙ, И ЛИСТ РОВНО ПОД НЕГО.
 *
 * Больше двадцати вещей закройщику на руки не выдают (настройка цеха
 * max_quantity_orders_to_cutter), поэтому лист печатается ОДНОЙ страницей на
 * весь стек: 10 рядов по 2 колонки.
 *
 * Была попытка считать число позиций по реальной высоте сетки — и она вышла
 * боком. Сетка резалась на блоки по материалу, каждый блок занимал целые ряды
 * (материал с одной позицией съедал ряд целиком), и на десяти материалах лист
 * распухал вдвое: двадцать вещей уезжали на две-три страницы. Закройщик
 * получал пачку бумаги вместо одного листа.
 *
 * Поэтому сетка теперь СПЛОШНАЯ, без разрывов между материалами: заказы и так
 * отсортированы по материалу и идут подряд, а смену материала показываем
 * жирной линией внутри той же сетки — она не отнимает ни одного ряда. */
const ROWS_PER_PAGE = 10;
const ITEMS_PER_PAGE = COLS * ROWS_PER_PAGE;

/* Высота ячейки. Считается от худшего случая: лист с шапкой И обоими
 * баннерами (связки + покупки OZON) обязан влезть в страницу целиком.
 *   1123 − 12·2 (поля) − 42 (шапка) − 62 (баннер связок) − 82 (баннер покупок)
 *   = 913 на десять рядов → 91 px на ряд.
 *
 * Берём 90. Содержимому самой плотной ячейки (размер + номер + плашка
 * «НЕ ПУТАТЬ» + «ОВЕРЛОК» + площадка) нужно 77 px — замерено. Запас 13 px
 * нужен обязательно: на планшете шрифт может отрисоваться чуть крупнее
 * нашего расчёта, и при запасе в пару пикселей строки наезжали друг на
 * друга — именно это видно на листе от 23.09. */
const CELL_HEIGHT_PX = 90;
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

/**
 * Порядок вещей ВНУТРИ одного материала.
 *
 * ПОЧЕМУ ЛИСТ ВЫГЛЯДЕЛ «ВПЕРЕМЕШКУ». Раньше здесь сортировались только связки
 * Яндекса — по groupKey и позиции в связке. У заказов OZON groupKey пустой,
 * поэтому для них сортировка не делала НИЧЕГО: вещи оставались в том порядке,
 * в каком их выдал сервер (по срокам и приоритету), и размеры шли вразнобой —
 * «Лен 200×245, Лен 300×265, Лен 300×255, Лен 300×245».
 *
 * Для закройщицы это лишняя работа: одинаковые размеры она кроит стопкой за
 * один заход, а разбросанные по листу — ищет глазами и перекладывает ткань.
 *
 * Теперь порядок такой:
 *   1) сначала одиночные вещи, потом связки (у связок groupKey непустой);
 *   2) связка идёт целиком и по своим позициям — её вешают на одну вешалку;
 *   3) одиночные — по ширине, затем по высоте: одинаковые размеры рядом;
 *   4) при полном совпадении — по номеру заказа, чтобы порядок не «плавал»
 *      от печати к печати.
 */
const compareWithinMaterial = (a: TakenOrder, b: TakenOrder) => {
  const ga = a.groupKey || '';
  const gb = b.groupKey || '';
  if (ga !== gb) return ga.localeCompare(gb);
  // Обе вещи из одной связки — только позиция в ней и решает.
  if (ga) return (a.groupPosition || 0) - (b.groupPosition || 0);
  if ((a.width || 0) !== (b.width || 0)) return (a.width || 0) - (b.width || 0);
  if ((a.height || 0) !== (b.height || 0)) return (a.height || 0) - (b.height || 0);
  return (a.orderNumber || '').localeCompare(b.orderNumber || '');
};

/**
 * Группирует заказы по материалу: один материал идёт сплошным блоком.
 *
 * Порядок САМИХ материалов не трогаем — он приходит с сервера и учитывает
 * приоритет раскроя (залежавшиеся заказы, FBS, быстрые в раскрое ткани).
 * Пересортируй мы материалы по алфавиту, и очередь цеха сломалась бы.
 * Наводим порядок только ВНУТРИ материала — см. compareWithinMaterial.
 */
const groupByMaterial = (orders: TakenOrder[]): TakenOrder[] => {
  const groups = new Map<string, TakenOrder[]>();
  for (const o of orders) {
    const key = o.material || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }
  for (const list of groups.values()) list.sort(compareWithinMaterial);
  return Array.from(groups.values()).flat();
};

/** Подпись связки в позиции листа: «СВЯЗКА 3/32 — одна вешалка». */
const groupNote = (o: TakenOrder) =>
  o.groupSize && o.groupSize > 1
    ? `<span style="font-size:10px;font-weight:800;white-space:nowrap;
                    line-height:1;">СВЯЗКА ${o.groupPosition}/${o.groupSize} — ОДНА ВЕШАЛКА</span>`
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
/* ПОЧЕМУ line-height:1.4, А НЕ 1.
 *
 * При line-height:1 строка ровно равна кеглю, и места под выносные элементы
 * букв не остаётся: глиф прижимается к нижнему краю строки, а рамка обводки
 * рисуется по ней. На печати текст выглядел приклеенным к нижней линии и
 * наезжал на неё, хотя сверху внутри рамки оставался пустой зазор.
 *
 * Полуторный интервал даёт одинаковый отступ сверху и снизу — текст встаёт
 * по центру обводки. Высоту плашки это добавляет на 3–4 px, запас в ячейке
 * (90 px против 77 px содержимого) их выдерживает. */
const purchaseNote = (o: TakenOrder) =>
  o.purchaseSize && o.purchaseSize > 1
    ? `<span style="font-size:10px;font-weight:900;white-space:nowrap;
                    line-height:1.4;border:2px solid #000;border-radius:2px;
                    padding:0 4px;display:inline-block;">1 ПОКУПАТЕЛЬ ${
                      o.purchasePosition
                    }/${o.purchaseSize} — НЕ ПУТАТЬ</span>`
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
    ? `<span style="font-size:11px;font-weight:900;white-space:nowrap;
                    line-height:1.4;background:#000;color:#fff;border-radius:2px;
                    padding:0 5px;display:inline-block;">ОВЕРЛОК</span>`
    : '';

/** Режет заказы на страницы по 20 позиций — ровно столько влезает в лист A4. */
const paginate = (orders: TakenOrder[]): TakenOrder[][] => {
  const pages: TakenOrder[][] = [];
  for (let i = 0; i < orders.length; i += ITEMS_PER_PAGE) {
    pages.push(orders.slice(i, i + ITEMS_PER_PAGE));
  }
  return pages;
};

const sizeLabel = (o: TakenOrder) => `${o.material || '—'} ${o.width ?? '—'} × ${o.height ?? '—'}`;

/** Ширина ячейки в сетке 2 колонки. */
const CELL_WIDTH_PX = (A4_WIDTH_PX - PAGE_PADDING_PX * 2) / COLS;

/* РАЗМЕР И НОМЕР ЗАКАЗА — САМОЕ ГЛАВНОЕ НА ЛИСТЕ. ИХ НЕ МЕЛЬЧИМ.
 *
 * Была попытка «честно» подбирать кегль под ширину строки и дополнительно
 * ужимать его на 15–30 %, если в ячейке есть метки. Результат: на обычном
 * листе размер и номер стали мелкими, и закройщик перестал их читать, не
 * поднося лист к глазам. Ради того, чтобы метка влезла, испортили ровно то,
 * что на листе читают чаще всего.
 *
 * Правильный порядок обратный: кегль держим крупным всегда, а длинную строку
 * при необходимости сжимаем по ГОРИЗОНТАЛИ (transform: scaleX). Высота букв
 * при этом не меняется — строка остаётся такой же читаемой, просто буквы чуть
 * уже. За рамку она при этом не выходит никогда.
 *
 * Метки (связка, покупка, оверлок) занимают свои строки снизу; под них в
 * ячейке 88 px места хватает и при полном кегле. */

/** Ширина строки в пикселях при данном кегле. Arial Bold ≈ 0.58 кегля на знак. */
const textWidthPx = (text: string, font: number) => Math.max(text.length, 1) * font * 0.58;

/**
 * Горизонтальное сжатие строки, если она не влезает в ширину ячейки.
 *
 * Возвращает готовый стиль. 1 — строка влезает как есть, меньше 1 — буквы
 * сужаются. Ниже 0.62 не опускаемся: дальше текст превращается в нечитаемую
 * гармошку, и лучше дать строке чуть вылезти, чем напечатать нечитаемое.
 */
const squeeze = (text: string, font: number, availWidth: number) => {
  const w = textWidthPx(text, font);
  if (w <= availWidth) return '';
  const scale = Math.max(0.62, availWidth / w);
  return `display:inline-block;transform:scaleX(${scale.toFixed(2)});transform-origin:center;`;
};

/**
 * НИЖНЯЯ СТРОКА ЯЧЕЙКИ: МЕТКИ И МАРКЕТПЛЕЙС — В ОДИН РЯД.
 *
 * Раньше маркетплейс стоял отдельной строкой, а метки шли под ним каждая со
 * своей строки. В ячейке 88 px это не помещалось: размер, номер, «OZON» и
 * плашка «1 ПОКУПАТЕЛЬ 1/4 — НЕ ПУТАТЬ» в сумме выше ячейки — плашку
 * выдавливало вниз, она налезала на «OZON» и срезалась рамкой. Именно это
 * видно на листе Коротаевой от 23.09.
 *
 * Чинится не уменьшением шрифта, а раскладкой: плашка и название площадки
 * занимают ОДНУ строку бок о бок. Высота экономится сразу на целую строку,
 * и всё встаёт внутрь рамки без потери кегля.
 *
 * Связка (Яндекс) и покупка (OZON) — с разных площадок и вместе не встречаются,
 * поэтому в ряду максимум: одна такая метка + «ОВЕРЛОК» + название площадки.
 * Ряд выровнен по левому краю с небольшим отступом — так плашка стоит чуть
 * левее центра, как и просили, а размер с номером остаются по центру.
 *
 * Отступ сверху — 7 px, а не 2. При двух пикселях рамка плашки «НЕ ПУТАТЬ»
 * подходила вплотную к цифрам номера заказа и на печати читалась как одна
 * слитая строка. Запас высоты в ячейке (90 px против 77 px содержимого) это
 * позволяет — ничего не выдавливается за рамку.
 */
const noteRow = (o: TakenOrder, mpFont: number) => {
  const parts = [groupNote(o), purchaseNote(o), overlockNote(o)].filter(Boolean);
  // Схема отгрузки (FBS/FBO) здесь больше не печатается — она переехала в
  // табличку справа, над ID закройщика. В этой строке остаётся только площадка.
  const mp = `<span style="font-size:${mpFont}px;font-weight:700;color:#222;
                           line-height:1;white-space:nowrap;">${o.marketplace}</span>`;
  // Меток нет — площадка просто стоит по центру, как раньше.
  if (!parts.length) {
    return `<div style="flex:0 0 auto;margin-top:4px;line-height:1;">${mp}</div>`;
  }
  // flex:0 0 auto ОБЯЗАТЕЛЕН.
  //
  // Ячейка — колоночный flex, и её содержимое по умолчанию СЖИМАЕТСЯ, когда не
  // помещается. Сжимается при этом блок, а не буквы: текст остаётся прежнего
  // размера и вылезает за края своего блока — плашка наползала на номер заказа
  // и срезалась нижней рамкой. Запрещаем сжатие: пусть лучше ряд встанет как
  // есть, чем строки наедут друг на друга.
  //
  // Отрицательных полей здесь быть не должно: они выносили плашку за внутренний
  // отступ ячейки, и рамка резала её сбоку.
  return `<div style="flex:0 0 auto;margin-top:7px;display:flex;align-items:center;
                      justify-content:center;gap:5px;flex-wrap:nowrap;
                      line-height:1;">${parts.join('')}${mp}</div>`;
};

// Ячейка одной позиции: слева крупно материал+размер и мелко маркетплейс+номер (+ID закройщика
// на QR-листе), справа узкая колонка (пустая — под галочку/крепление бирки), как в образце.
/** Ячейка одной позиции. Вещи связки выделяем жирной рамкой и серой заливкой: на листе
 * из 20 позиций закройщик должен видеть их с одного взгляда, а не вычитывать подписи. */
/** Табличка ID закройщика в правом углу ячейки.
 *
 * По этому номеру швея и бригадир понимают, кто раскроил вещь: на вешалке висит
 * десяток бирок от разных закройщиков, и разобрать их иначе невозможно. Раньше ID
 * печатался мелким шрифтом в общей строке с маркетплейсом — его не читали. */
/**
 * Табличка справа: схема отгрузки СВЕРХУ, ID закройщика снизу.
 *
 * ЗАЧЕМ СХЕМА ПЕРЕЕХАЛА СЮДА. Раньше «FBS»/«FBO» стояли в нижней строке рядом
 * с площадкой и метками. Строка там и так самая тесная: в неё вмещаются плашка
 * «НЕ ПУТАТЬ», «ОВЕРЛОК» и название площадки — схему в этой мешанине не
 * читали. А работа по ней разная: FBS клеится поштучно своим ярлыком, FBO
 * уезжает коробкой на склад площадки.
 *
 * В правой табличке для неё есть место, и она попадает на одну вертикаль с ID —
 * два самых «служебных» поля собраны в один угол. Заодно нижняя строка ячейки
 * разгружается, и метки перестают тесниться.
 *
 * Схема залита чёрным: на листе из двадцати позиций серый текст теряется, а
 * различать FBS и FBO нужно с одного взгляда.
 */
const idBadge = (cutterId: number | null, orderType?: string | null) => {
  if (cutterId == null) return '';
  const scheme = orderType
    ? `<div style="background:#000;color:#fff;font-size:11px;font-weight:900;
                   letter-spacing:0.5px;padding:2px 0;width:100%;text-align:center;
                   line-height:1.3;">${orderType}</div>`
    : '';
  return `<div style="border-left:2px solid #000;display:flex;flex-direction:column;
                      align-items:center;justify-content:center;line-height:1;
                      overflow:hidden;">
            ${scheme}
            <div style="display:flex;flex-direction:column;align-items:center;
                        justify-content:center;flex:1 1 auto;line-height:1;">
              <div style="font-size:9px;font-weight:700;letter-spacing:0.5px;">ID</div>
              <div style="font-size:24px;font-weight:800;">${cutterId}</div>
            </div>
          </div>`;
};

/**
 * Ячейка одной позиции.
 *
 * isNewMaterial — с этой позиции начинается другой материал. Помечаем ТОЛСТОЙ
 * верхней линией вместо разрыва сетки: раньше между материалами вставлялся
 * отступ, из-за чего каждый материал занимал целые ряды и двадцать позиций
 * переставали помещаться на лист. Линия показывает границу так же наглядно, но
 * не съедает ни одного ряда.
 */
const cell = (
  inner: string,
  isGroup = false,
  cutterId: number | null = null,
  isNewMaterial = false,
  orderType?: string | null
) =>
  `<div style="display:grid;grid-template-columns:1fr${
    cutterId != null ? ' 52px' : ''
  };border:${
    isGroup ? '4px solid #000' : '2px solid #000'
  };${
    isNewMaterial ? 'border-top:5px solid #000;' : ''
  }box-sizing:border-box;height:${CELL_HEIGHT_PX}px;overflow:hidden;${
    isGroup ? 'background:#e8e8e8;' : ''
  }">
     ${inner}
     ${idBadge(cutterId, orderType)}
   </div>`;

/** Сплошная сетка 2 колонки: смена материала отмечена жирной линией сверху. */
const groupedGrid = (
  pageOrders: TakenOrder[],
  renderInner: (o: TakenOrder) => string,
  cutterId: number | null = null
) => {
  let current: string | null = null;
  const cells = pageOrders.map((o, i) => {
    const key = o.material || '—';
    // Первый ряд линией не отбиваем: сверху и так рамка ячейки.
    const isNew = current !== null && key !== current && i >= COLS;
    current = key;
    return cell(
      renderInner(o),
      !!(o.groupSize && o.groupSize > 1),
      cutterId,
      isNew,
      o.orderType
    );
  });
  return `<div style="display:grid;grid-template-columns:1fr 1fr;">${cells.join('')}</div>`;
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
  // Кегль ПОСТОЯННЫЙ и крупный — 23 px. Длинные строки ужимаются по ширине,
  // высота букв не меняется: читается с вытянутой руки в любом случае.
  const SIZE_FONT = 23;
  const NUM_FONT = 23;
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="padding:3px 10px;text-align:center;display:flex;flex-direction:column;
                  justify-content:center;height:100%;box-sizing:border-box;overflow:hidden;">
        <div style="flex:0 0 auto;font-size:${SIZE_FONT}px;font-weight:800;line-height:1.05;
                    white-space:nowrap;${squeeze(sizeLabel(o), SIZE_FONT, textWidth)}">${sizeLabel(
                      o
                    )}</div>
        <div style="flex:0 0 auto;font-size:${NUM_FONT}px;font-weight:800;margin-top:2px;
                    letter-spacing:0.3px;white-space:nowrap;line-height:1.1;
                    ${squeeze(o.orderNumber || '', NUM_FONT, textWidth)}">${o.orderNumber}</div>
        ${noteRow(o, 11)}
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
  // Кегль постоянный: бирку читают уже приколотой к ткани на вешалке, мелкий
  // шрифт там не разобрать. Длинные строки ужимаются по ширине.
  const SIZE_FONT = 20;
  const NUM_FONT = 20;
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="position:relative;height:100%;box-sizing:border-box;overflow:hidden;
                  padding:3px 6px 3px ${QR_SIZE_PX + 10}px;
                  display:flex;flex-direction:column;justify-content:center;text-align:center;">
        <img src="${qrDataUrls[o.id]}"
             style="position:absolute;left:5px;top:50%;transform:translateY(-50%);
                    width:${QR_SIZE_PX}px;height:${QR_SIZE_PX}px;" />
        <div style="flex:0 0 auto;font-size:${SIZE_FONT}px;font-weight:800;line-height:1.05;
                    white-space:nowrap;${squeeze(sizeLabel(o), SIZE_FONT, textWidth)}">${sizeLabel(
                      o
                    )}</div>
        <div style="flex:0 0 auto;font-size:${NUM_FONT}px;font-weight:800;margin-top:2px;
                    white-space:nowrap;line-height:1.1;
                    ${squeeze(o.orderNumber || '', NUM_FONT, textWidth)}">${o.orderNumber}</div>
        ${noteRow(o, 10)}
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