import type jsPDFType from 'jspdf';

const WORKSHOP_MATERIALS_URL = 'https://functions.poehali.dev/db49c8fd-1344-4e72-a6e8-5a2c90a2656a';

export interface ReportRoll {
  id: number;
  barcode: string;
  materialId: number;
  materialName: string;
  unit: string;
  typeName: string;
  workshopId: number;
  workshopName: string;
  shiftNumber: number | null;
  initialQuantity: number;
  remainingQuantity: number;
  usedQuantity: number;
  opened: boolean;
  pendingAcceptance: boolean;
  lastUsedAt: string | null;
  idleHours: number | null;
  cutters: string | null;
}

export interface ReportShift {
  workshopId: number;
  workshopName: string;
  shiftNumber: number | null;
  shiftLabel: string;
}

/** Граница: рулон без расхода неделю и дольше считаем застрявшим. */
const STUCK_HOURS = 7 * 24;

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const LINES_PER_PAGE = 30;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ru-RU');

const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

const fmtIdle = (hours: number | null) => {
  if (hours == null) return '—';
  if (hours < 24) return `${Math.floor(hours)} ч`;
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return h ? `${d} дн ${h} ч` : `${d} дн`;
};

const shortName = (full: string) => {
  const [last, ...rest] = full.trim().split(/\s+/);
  const initials = rest.map((p) => `${p[0].toUpperCase()}.`).join('');
  return initials ? `${last} ${initials}` : last;
};

const cuttersText = (v: string | null) =>
  v ? v.split(',').map((n) => shortName(n)).join(', ') : '—';

type Line =
  | { kind: 'title'; text: string; sub?: string }
  | { kind: 'group'; text: string; tone: 'red' | 'green' | 'grey' }
  | { kind: 'rollHead' }
  | { kind: 'roll'; roll: ReportRoll; n: number }
  | { kind: 'matHead' }
  | { kind: 'mat'; name: string; unit: string; total: number; qty: number; stuck: number; fresh: number; maxIdle: number | null }
  | { kind: 'empty'; text: string };

const cell = (text: string, align = 'left', extra = '') =>
  `<td style="text-align:${align};font-size:10.5px;padding:4px 5px;border-bottom:1px solid #ccc;${extra}">${text}</td>`;

const head = (cols: [string, string, string?][]) =>
  `<tr>${cols
    .map(
      ([t, w, a]) =>
        `<td style="width:${w};text-align:${a || 'left'};font-size:10px;font-weight:700;padding:4px 5px;border-bottom:2px solid #000;">${t}</td>`,
    )
    .join('')}</tr>`;

const toneBg = { red: '#fde2e2', green: '#e3f5e8', grey: '#eee' };

const renderLine = (l: Line) => {
  switch (l.kind) {
    case 'title':
      return `<tr><td colspan="8" style="padding:12px 0 4px;font-size:15px;font-weight:800;border-bottom:2px solid #000;">${esc(l.text)}${
        l.sub ? `<span style="font-size:11px;font-weight:400;margin-left:8px;">${esc(l.sub)}</span>` : ''
      }</td></tr>`;
    case 'group':
      return `<tr><td colspan="8" style="padding:5px;font-size:11.5px;font-weight:700;background:${toneBg[l.tone]};">${esc(l.text)}</td></tr>`;
    case 'rollHead':
      return head([
        ['#', '4%', 'center'],
        ['Рулон', '13%'],
        ['Материал', '22%'],
        ['Остаток', '14%', 'right'],
        ['Открыт', '8%', 'center'],
        ['Простой', '11%', 'center'],
        ['Посл. расход', '10%', 'center'],
        ['Кто кроил', '18%'],
      ]);
    case 'roll': {
      const r = l.roll;
      const stuck = (r.idleHours ?? 0) >= STUCK_HOURS;
      return `<tr>${cell(String(l.n), 'center')}${cell(esc(r.barcode), 'left', 'font-weight:700;font-family:monospace;')}${cell(
        esc(r.materialName),
      )}${cell(
        r.opened
          ? `${fmtQty(r.remainingQuantity)} / ${fmtQty(r.initialQuantity)} ${esc(r.unit)}`
          : `${fmtQty(r.remainingQuantity)} ${esc(r.unit)}`,
        'right',
      )}${cell(r.pendingAcceptance ? 'в пути' : r.opened ? 'да' : 'нет', 'center', r.opened ? '' : 'font-weight:700;')}${cell(
        fmtIdle(r.idleHours),
        'center',
        stuck ? 'font-weight:700;color:#b91c1c;' : '',
      )}${cell(r.lastUsedAt ? fmtDate(new Date(r.lastUsedAt)) : '—', 'center')}${cell(esc(cuttersText(r.cutters)))}</tr>`;
    }
    case 'matHead':
      return head([
        ['Материал', '34%'],
        ['Рулонов', '10%', 'center'],
        ['Остаток', '16%', 'right'],
        ['Простой ≥7 сут', '14%', 'center'],
        ['Менее 7 сут', '12%', 'center'],
        ['Макс. простой', '14%', 'center'],
      ]);
    case 'mat':
      return `<tr>${cell(esc(l.name), 'left', 'font-weight:700;')}${cell(String(l.total), 'center')}${cell(
        `${fmtQty(l.qty)} ${esc(l.unit)}`,
        'right',
      )}${cell(l.stuck ? String(l.stuck) : '—', 'center', l.stuck ? 'font-weight:700;color:#b91c1c;' : '')}${cell(
        l.fresh ? String(l.fresh) : '—',
        'center',
      )}${cell(fmtIdle(l.maxIdle), 'center')}</tr>`;
    case 'empty':
      return `<tr><td colspan="8" style="padding:5px;font-size:11px;color:#666;">${esc(l.text)}</td></tr>`;
  }
};

const shiftKey = (wid: number, shift: number | null) => `${wid}-${shift ?? 'x'}`;

const byIdleDesc = (a: ReportRoll, b: ReportRoll) => (b.idleHours ?? 0) - (a.idleHours ?? 0);

const buildLines = (rolls: ReportRoll[], shifts: ReportShift[], showWorkshop: boolean): Line[] => {
  const lines: Line[] = [];

  shifts.forEach((s) => {
    const mine = rolls.filter((r) => shiftKey(r.workshopId, r.shiftNumber) === shiftKey(s.workshopId, s.shiftNumber));
    if (mine.length === 0) return;
    const stuck = mine.filter((r) => (r.idleHours ?? 0) >= STUCK_HOURS).sort(byIdleDesc);
    const fresh = mine.filter((r) => (r.idleHours ?? 0) < STUCK_HOURS).sort(byIdleDesc);
    lines.push({
      kind: 'title',
      text: `${showWorkshop ? `${s.workshopName} · ` : ''}${s.shiftLabel}`,
      sub: `рулонов ${mine.length}, простой 7 суток и больше — ${stuck.length}`,
    });
    let n = 0;
    lines.push({ kind: 'group', text: `Простой 7 суток и больше — ${stuck.length}`, tone: 'red' });
    if (stuck.length) {
      lines.push({ kind: 'rollHead' });
      stuck.forEach((r) => lines.push({ kind: 'roll', roll: r, n: ++n }));
    } else lines.push({ kind: 'empty', text: 'Нет' });
    lines.push({ kind: 'group', text: `Простой менее 7 суток — ${fresh.length}`, tone: 'green' });
    if (fresh.length) {
      lines.push({ kind: 'rollHead' });
      fresh.forEach((r) => lines.push({ kind: 'roll', roll: r, n: ++n }));
    } else lines.push({ kind: 'empty', text: 'Нет' });
  });

  // Сводка по материалам: сколько рулонов застряло и сколько в работе.
  const mats = new Map<number, Extract<Line, { kind: 'mat' }> & { type: string }>();
  rolls.forEach((r) => {
    const m =
      mats.get(r.materialId) ||
      { kind: 'mat' as const, name: r.materialName, unit: r.unit, type: r.typeName, total: 0, qty: 0, stuck: 0, fresh: 0, maxIdle: null };
    m.total += 1;
    m.qty += r.remainingQuantity;
    if ((r.idleHours ?? 0) >= STUCK_HOURS) m.stuck += 1;
    else m.fresh += 1;
    m.maxIdle = Math.max(m.maxIdle ?? 0, r.idleHours ?? 0);
    mats.set(r.materialId, m);
  });
  const list = [...mats.values()];
  const freshList = list.filter((m) => m.fresh > 0).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const allList = list.sort((a, b) => b.stuck - a.stuck || a.name.localeCompare(b.name, 'ru'));

  lines.push({ kind: 'title', text: 'Список материалов', sub: `всего ${allList.length}, сверху — где больше застрявших рулонов` });
  lines.push({ kind: 'matHead' });
  allList.forEach((m) => lines.push(m));

  lines.push({ kind: 'title', text: 'Материалы с рулонами в работе (простой менее 7 суток)', sub: `${freshList.length}` });
  if (freshList.length) {
    lines.push({ kind: 'matHead' });
    freshList.forEach((m) => lines.push(m));
  } else lines.push({ kind: 'empty', text: 'Нет ни одного материала, с которым работали за последнюю неделю' });

  return lines;
};

/** Режем по страницам; заголовок таблицы повторяем, если страница началась с середины списка. */
const paginate = (lines: Line[]) => {
  const pages: Line[][] = [];
  let cur: Line[] = [];
  let lastHead: Line | null = null;
  lines.forEach((l) => {
    if (l.kind === 'rollHead' || l.kind === 'matHead') lastHead = l;
    if (l.kind === 'title' || l.kind === 'group' || l.kind === 'empty') {
      if (l.kind === 'title') lastHead = null;
    }
    // Не оставляем заголовок раздела одиноко внизу листа.
    const reserve = l.kind === 'title' || l.kind === 'group' ? 3 : 0;
    if (cur.length + 1 + reserve > LINES_PER_PAGE) {
      pages.push(cur);
      cur = [];
      if ((l.kind === 'roll' || l.kind === 'mat') && lastHead) cur.push(lastHead);
    }
    cur.push(l);
  });
  if (cur.length) pages.push(cur);
  return pages;
};

const pageHtml = (lines: Line[], title: string, pageNo: number, pages: number) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:24px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #000;padding-bottom:6px;">
      <div>
        <div style="font-size:18px;font-weight:800;">ПРОСТОЙ РУЛОНОВ В ЦЕХЕ</div>
        <div style="font-size:12px;margin-top:2px;">${esc(title)}</div>
      </div>
      <div style="font-size:11px;text-align:right;">${fmtDate(new Date())}<br/>лист ${pageNo} из ${pages}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">${lines.map(renderLine).join('')}</table>
  </div>`;

const renderPage = async (pdf: jsPDFType, html: string, first: boolean) => {
  const box = document.createElement('div');
  box.style.position = 'fixed';
  box.style.left = '-99999px';
  box.style.top = '0';
  box.innerHTML = html;
  document.body.appendChild(box);
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(box.firstElementChild as HTMLElement, { scale: 2 });
    if (!first) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
  } finally {
    document.body.removeChild(box);
  }
};

/**
 * PDF о простое рулонов по сменам: какой рулон, сколько осталось, открыт ли,
 * сколько лежит без дела и кто из закройщиков с ним работал. В конце — список
 * материалов и отдельно материалы, с которыми работали за последние 7 суток.
 */
export const printWorkshopRollsReport = async (shifts: ReportShift[], title: string, workshopId?: number) => {
  const url = workshopId ? `${WORKSHOP_MATERIALS_URL}?report=1&workshop_id=${workshopId}` : `${WORKSHOP_MATERIALS_URL}?report=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось получить рулоны');
  const data = (await res.json()) as { rolls: ReportRoll[] };
  const allowed = new Set(shifts.map((s) => shiftKey(s.workshopId, s.shiftNumber)));
  const rolls = (data.rolls || []).filter((r) => allowed.has(shiftKey(r.workshopId, r.shiftNumber)));
  if (rolls.length === 0) throw new Error('В выбранных сменах нет рулонов');

  const showWorkshop = new Set(shifts.map((s) => s.workshopId)).size > 1;
  const pages = paginate(buildLines(rolls, shifts, showWorkshop));
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  for (let i = 0; i < pages.length; i++) {
    await renderPage(pdf, pageHtml(pages[i], title, i + 1, pages.length), i === 0);
  }
  pdf.save(`prostoy-rulonov-${fmtDate(new Date()).replace(/\./g, '-')}.pdf`);
};

export default printWorkshopRollsReport;
