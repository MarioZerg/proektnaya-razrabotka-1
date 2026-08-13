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
const ROWS_PER_PAGE = 10;
const ITEMS_PER_PAGE = COLS * ROWS_PER_PAGE;
// Высота ячейки подобрана так, чтобы 10 строк заполняли лист А4 целиком — с учётом
// полей, шапки и отступов между группами материалов.
//
// Раньше шрифт номера был 11px: швея не могла прочитать его на вешалке, не поднося
// лист к глазам. Кегли увеличены вдвое, но число позиций осталось прежним — 20 на
// лист, иначе закройщик печатал бы вдвое больше бумаги.
const CELL_HEIGHT_PX = 79;
// QR печатается ВНУТРИ рамки, поэтому он должен быть заметно меньше её высоты:
// иначе картинка упирается в границы и вылезает за рамку соседней колонки.
//
// На эту же ширину слева отступает текст: без отступа он центрировался по всей
// ячейке и наезжал на QR — казалось, что надпись сдвинута вправо и висит криво.
const QR_SIZE_PX = 64;

const formatToday = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

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

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
};

const sizeLabel = (o: TakenOrder) => `${o.material || '—'} ${o.width ?? '—'} × ${o.height ?? '—'}`;

/** Размер шрифта под длину строки: «Мрамор 300 × 250» длиннее «Лен 200 × 245» и при
 * одинаковом кегле переносится на вторую строку, съедая место у номера заказа.
 * Подбираем размер так, чтобы строка всегда влезала в одну. */
const sizeFont = (o: TakenOrder, max: number) => {
  const len = sizeLabel(o).length;
  if (len > 19) return Math.round(max * 0.78);
  if (len > 16) return Math.round(max * 0.88);
  return max;
};

/** То же для номера заказа: у WB он короткий, у OZON — длинный с дефисами. */
const numberFont = (o: TakenOrder, max: number) => {
  const len = (o.orderNumber || '').length;
  if (len > 19) return Math.round(max * 0.78);
  if (len > 15) return Math.round(max * 0.88);
  return max;
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
  return `<div style="display:flex;flex-direction:column;gap:4px;">${blocks.join('')}</div>`;
};

const page = (inner: string) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:12px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">${inner}</div>`;

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
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:stretch;margin-bottom:8px;">
      <div style="border:2px solid #000;padding:4px 12px;font-size:16px;font-weight:800;">${cutterName}</div>
      <div style="border:2px solid #000;padding:4px 12px;font-size:16px;font-weight:800;">${date}</div>
    </div>` + groupsBanner;
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="padding:4px 10px;text-align:center;display:flex;flex-direction:column;
                  justify-content:center;height:100%;box-sizing:border-box;">
        <div style="font-size:${sizeFont(o, o.groupSize && o.groupSize > 1 ? 20 : 23)}px;
                    font-weight:800;line-height:1.05;white-space:nowrap;">${sizeLabel(o)}</div>
        <div style="font-size:${numberFont(o, o.groupSize && o.groupSize > 1 ? 20 : 23)}px;
                    font-weight:800;margin-top:2px;letter-spacing:0.3px;white-space:nowrap;
                    line-height:1.1;">${o.orderNumber}</div>
        <div style="font-size:${o.groupSize && o.groupSize > 1 ? 9 : 11}px;font-weight:700;
                    color:#222;margin-top:1px;line-height:1;">${o.marketplace}</div>
        ${groupNote(o)}
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
  const grid = groupedGrid(
    pageOrders,
    (o) => `
      <div style="position:relative;height:100%;box-sizing:border-box;
                  padding:4px 6px 4px ${QR_SIZE_PX + 10}px;
                  display:flex;flex-direction:column;justify-content:center;text-align:center;">
        <img src="${qrDataUrls[o.id]}"
             style="position:absolute;left:5px;top:50%;transform:translateY(-50%);
                    width:${QR_SIZE_PX}px;height:${QR_SIZE_PX}px;" />
        <div style="font-size:${sizeFont(o, 20)}px;font-weight:800;line-height:1.05;
                    white-space:nowrap;">${sizeLabel(o)}</div>
        <div style="font-size:${numberFont(o, 20)}px;font-weight:800;margin-top:2px;
                    white-space:nowrap;line-height:1.1;">${o.orderNumber}</div>
        <div style="font-size:10px;font-weight:700;color:#222;margin-top:1px;line-height:1;">
          ${o.marketplace} [${o.orderType}]
        </div>
        ${groupNote(o)}
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
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
  } finally {
    document.body.removeChild(container);
  }
};

export const printCuttingSheet = async (
  orders: TakenOrder[],
  cutterName: string,
  cutterId: number | null = null
) => {
  if (orders.length === 0) return;

  const grouped = groupByMaterial(orders);
  const checklistPages = chunk(grouped, ITEMS_PER_PAGE);
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
  const qrPages = chunk(grouped, ITEMS_PER_PAGE);

  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  let isFirstPage = true;
  for (const pageOrders of checklistPages) {
    await renderPageToPdf(
      pdf,
      buildChecklistPageHtml(pageOrders, cutterName, date, cutterId),
      isFirstPage
    );
    isFirstPage = false;
  }
  for (const pageOrders of qrPages) {
    await renderPageToPdf(pdf, buildQrPageHtml(pageOrders, qrDataUrls, cutterId), isFirstPage);
    isFirstPage = false;
  }

  pdf.save(`Лист закройщика ${date.replace(/\//g, '-')}.pdf`);
};