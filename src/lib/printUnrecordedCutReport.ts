import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  esc,
  fmtDate,
  fmtQty,
  renderPage,
  shiftKey,
  shortName,
  translit,
  wait,
  type ReportRoll,
  type ReportShift,
} from '@/lib/printWorkshopRollsReport';

const WORKSHOP_MATERIALS_URL = 'https://functions.poehali.dev/db49c8fd-1344-4e72-a6e8-5a2c90a2656a';

/** Мелкие расхождения (усадка, обрезки на замере) не считаем: 2% рулона, но не меньше 1. */
const isMissing = (r: ReportRoll) =>
  (r.unrecordedQuantity ?? 0) > Math.max(1, r.initialQuantity * 0.02);

const PAGE_BUDGET_PX = 930;
const ROW_PX = 92;

const COLS = ['5%', '15%', '17%', '20%', '15%', '28%'];

const names = (v?: string | null, limit = 6) => {
  if (!v) return '—';
  const list = v.split(',').map((n) => shortName(n));
  return list.length > limit ? `${list.slice(0, limit).join(', ')} +${list.length - limit}` : list.join(', ');
};

const td = (text: string, align = 'left', extra = '') =>
  `<td style="text-align:${align};vertical-align:middle;font-size:15px;line-height:1.3;padding:8px 6px;border-bottom:1px solid #999;${extra}">${text}</td>`;

const headRow = () =>
  `<tr>${[
    ['№', 'center'],
    ['Рулон', 'left'],
    ['Материал', 'left'],
    ['Было → осталось', 'right'],
    ['Не записано', 'center'],
    ['Кто кроил / кто был на смене', 'left'],
  ]
    .map(
      ([t, a]) =>
        `<td style="text-align:${a};font-size:13px;font-weight:700;text-transform:uppercase;padding:6px;border-bottom:3px solid #000;">${t}</td>`,
    )
    .join('')}</tr>`;

const row = (r: ReportRoll, n: number) => {
  const lost = r.unrecordedQuantity ?? 0;
  const pct = r.initialQuantity > 0 ? Math.round((lost / r.initialQuantity) * 100) : 0;
  const recorded = r.usedQuantity > 0
    ? `<div style="font-size:12px;color:#444;">в заказы: ${fmtQty(r.usedQuantity)}</div>`
    : '<div style="font-size:12px;font-weight:800;color:#b91c1c;">резку ни разу не записали</div>';
  const who = r.cutters
    ? `<div><b>Записано:</b> ${esc(names(r.cutters, 3))}</div>`
    : '';
  const shift = `<div style="font-size:13px;color:#333;margin-top:2px;"><b>На смене были:</b> ${esc(names(r.shiftCutters))}</div>`;
  return `<tr>${td(String(n), 'center', 'font-size:13px;color:#444;')}${td(
    `<span style="font-family:monospace;font-size:18px;font-weight:800;">${esc(r.barcode)}</span>`,
  )}${td(esc(r.materialName), 'left', 'font-weight:700;')}${td(
    `<span style="white-space:nowrap;">${fmtQty(r.initialQuantity)} → <b style="font-size:17px;">${fmtQty(r.remainingQuantity)}</b> ${esc(r.unit)}</span>${recorded}`,
    'right',
  )}${td(
    `<span style="display:inline-block;padding:5px 8px;border-radius:6px;background:#b91c1c;color:#fff;font-size:18px;font-weight:800;white-space:nowrap;">${fmtQty(lost)} ${esc(r.unit)}</span><div style="font-size:12px;margin-top:3px;">${pct}% рулона</div>`,
    'center',
  )}${td(who + shift, 'left', 'font-size:14px;')}</tr>`;
};

const table = (inner: string) =>
  `<table style="width:100%;border-collapse:collapse;table-layout:fixed;"><colgroup>${COLS.map(
    (w) => `<col style="width:${w}"/>`,
  ).join('')}</colgroup>${inner}</table>`;

const intro = (rolls: ReportRoll[]) => {
  const byUnit = new Map<string, number>();
  rolls.forEach((r) => byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + (r.unrecordedQuantity ?? 0)));
  const total = [...byUnit].map(([u, q]) => `${fmtQty(q)} ${esc(u)}`).join(' и ');
  return `<div style="border:3px solid #b91c1c;border-radius:10px;padding:12px 16px;margin:12px 0 10px;">
    <div style="font-size:22px;font-weight:800;color:#b91c1c;">МАТЕРИАЛ УШЁЛ БЕЗ ЗАПИСИ</div>
    <div style="font-size:17px;margin-top:6px;line-height:1.4;">
      С <b>${rolls.length}</b> рулонов ушло <b>${total}</b>, но ни в заказы, ни в брак, ни в недостачу это не записано.<br/>
      Скорее всего, кроили без сканирования рулона на терминале.<br/>
      Разберите с закройщиками каждый рулон: <b>всегда сканируйте рулон перед резкой</b>.
    </div>
  </div>`;
};

const page = (body: string, title: string, pageNo: number, pages: number) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:24px 26px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #000;padding-bottom:8px;">
      <div>
        <div style="font-size:26px;font-weight:800;">${esc(title)}</div>
        <div style="font-size:15px;margin-top:2px;">Резка без записи: метраж ушёл, а в системе пусто</div>
      </div>
      <div style="font-size:15px;text-align:right;font-weight:700;">${fmtDate(new Date())}<br/><span style="font-weight:400;">лист ${pageNo} из ${pages}</span></div>
    </div>
    ${body}
    ${
      pageNo === pages
        ? `<div style="margin-top:22px;font-size:15px;line-height:2;">
             Разобрал (ФИО, подпись): ____________________________________________<br/>
             Причина: ___________________________________________________________
           </div>`
        : ''
    }
  </div>`;

/**
 * PDF «Резка без записи» — отдельный файл на каждую смену. Рулоны, с которых
 * ушёл метраж, а расход нигде не записан: сколько пропало и кто из закройщиков
 * был на смене, пока рулон лежал в цехе. Сверху — где пропало больше всего.
 */
export const printUnrecordedCutReport = async (shifts: ReportShift[], workshopId?: number) => {
  const url = workshopId
    ? `${WORKSHOP_MATERIALS_URL}?report=1&workshop_id=${workshopId}`
    : `${WORKSHOP_MATERIALS_URL}?report=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось получить рулоны');
  const data = (await res.json()) as { rolls: ReportRoll[] };
  const all = (data.rolls || []).filter(isMissing);
  const { default: jsPDF } = await import('jspdf');
  const date = fmtDate(new Date()).replace(/\./g, '-');

  let made = 0;
  for (const s of shifts) {
    const key = shiftKey(s.workshopId, s.shiftNumber);
    const rolls = all
      .filter((r) => shiftKey(r.workshopId, r.shiftNumber) === key)
      .sort(
        (a, b) =>
          (b.unrecordedQuantity ?? 0) / (b.initialQuantity || 1) -
          (a.unrecordedQuantity ?? 0) / (a.initialQuantity || 1),
      );
    if (rolls.length === 0) continue;

    const title = `${s.workshopName} · ${s.shiftLabel}`;
    const pages: string[] = [];
    let rowsHtml = '';
    let used = 200;
    rolls.forEach((r, i) => {
      if (used + ROW_PX > PAGE_BUDGET_PX && rowsHtml) {
        pages.push(rowsHtml);
        rowsHtml = '';
        used = 0;
      }
      rowsHtml += row(r, i + 1);
      used += ROW_PX;
    });
    if (rowsHtml) pages.push(rowsHtml);

    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    for (let i = 0; i < pages.length; i++) {
      const body = (i === 0 ? intro(rolls) : '') + table(headRow() + pages[i]);
      await renderPage(pdf, page(body, title, i + 1, pages.length), i === 0);
    }
    if (made > 0) await wait(600);
    pdf.save(`rezka-bez-zapisi-${translit(s.workshopName)}-${translit(s.shiftLabel)}-${date}.pdf`);
    made += 1;
  }
  if (made === 0) throw new Error('В выбранных сменах нет рулонов с резкой без записи');
  return made;
};

export default printUnrecordedCutReport;
