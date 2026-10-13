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
  shortageQuantity?: number;
  packerReturnedQuantity?: number;
  defectQuantity?: number;
  /** Метраж ушёл с рулона, но ни в заказы, ни в брак, ни в недостачу не записан. */
  unrecordedQuantity?: number;
  /** Закройщики, выходившие на эту смену, пока рулон лежал в цехе. */
  shiftCutters?: string | null;
}

export interface ReportShift {
  workshopId: number;
  workshopName: string;
  shiftNumber: number | null;
  shiftLabel: string;
}

/** Граница: рулон без расхода неделю и дольше считаем застрявшим. */
const STUCK_HOURS = 7 * 24;

export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;
/** Высота под содержимое листа: без полей и шапки. */
const PAGE_BUDGET_PX = 960;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ru-RU');

export const fmtDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

const fmtIdle = (hours: number | null) => {
  if (hours == null) return '—';
  if (hours < 24) return `${Math.floor(hours)} ч`;
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  return h ? `${d} дн ${h} ч` : `${d} дн`;
};

export const shortName = (full: string) => {
  const [last, ...rest] = full.trim().split(/\s+/);
  const initials = rest.map((p) => `${p[0].toUpperCase()}.`).join('');
  return initials ? `${last} ${initials}` : last;
};

/** Не больше двух фамилий в ячейке: длинный список ломает строку на три этажа. */
const cuttersText = (v: string | null) => {
  if (!v) return '—';
  const names = v.split(',').map((n) => shortName(n));
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
};

type MatLine = {
  kind: 'mat';
  name: string;
  unit: string;
  total: number;
  qty: number;
  stuck: number;
  fresh: number;
  maxIdle: number | null;
};

type Line =
  | { kind: 'alert'; stuck: number; unopened: number; total: number }
  | { kind: 'title'; text: string; sub?: string }
  | { kind: 'group'; text: string; hint: string; tone: 'red' | 'green' }
  | { kind: 'rollHead' }
  | { kind: 'roll'; roll: ReportRoll; n: number }
  | { kind: 'matHead' }
  | MatLine
  | { kind: 'empty'; text: string };

/** Примерная высота строки на листе — по ней режем на страницы. */
const lineHeight = (l: Line) =>
  ({ alert: 200, title: 64, group: 72, rollHead: 40, roll: 66, matHead: 40, mat: 52, empty: 44 })[l.kind];

const COLS = 6;

const td = (text: string, align = 'left', extra = '') =>
  `<td style="text-align:${align};vertical-align:middle;font-size:15px;line-height:1.25;padding:7px 6px;border-bottom:1px solid #999;${extra}">${text}</td>`;

const head = (cols: [string, string, string?][]) =>
  `<tr>${cols
    .map(
      ([t, w, a]) =>
        `<td style="width:${w};text-align:${a || 'left'};font-size:13px;font-weight:700;text-transform:uppercase;padding:6px;border-bottom:3px solid #000;">${t}</td>`,
    )
    .join('')}</tr>`;

/** Простой крупной плашкой: красная — застрял, жёлтая — больше суток, белая — в работе. */
const idleBadge = (hours: number | null) => {
  const h = hours ?? 0;
  const style =
    h >= STUCK_HOURS
      ? 'background:#b91c1c;color:#fff;'
      : h >= 24
        ? 'background:#fde68a;color:#000;'
        : 'background:#fff;color:#000;border:1px solid #999;';
  return `<span style="display:inline-block;min-width:96px;padding:5px 8px;border-radius:6px;font-size:17px;font-weight:800;${style}">${fmtIdle(hours)}</span>`;
};

const renderLine = (l: Line) => {
  switch (l.kind) {
    case 'alert':
      return `<tr><td colspan="${COLS}" style="padding:10px 0 6px;">
        <div style="border:3px solid #b91c1c;border-radius:10px;padding:12px 16px;">
          <div style="font-size:22px;font-weight:800;color:#b91c1c;">ОБРАТИТЕ ВНИМАНИЕ</div>
          <div style="font-size:18px;margin-top:6px;line-height:1.4;">
            <b>${l.stuck}</b> из ${l.total} рулонов лежат без дела <b>7 суток и больше</b> — они в красном списке.<br/>
            Найдите каждый рулон по номеру. Кроите сначала из них или сдайте кладовщику.<br/>
            Не открыто ни разу: <b>${l.unopened}</b> — помечены «НЕ ОТКРЫТ».
          </div>
        </div>
      </td></tr>`;
    case 'title':
      return `<tr><td colspan="${COLS}" style="padding:16px 0 6px;font-size:22px;font-weight:800;border-bottom:3px solid #000;">${esc(l.text)}${
        l.sub ? `<span style="font-size:15px;font-weight:400;margin-left:10px;">${esc(l.sub)}</span>` : ''
      }</td></tr>`;
    case 'group': {
      const bg = l.tone === 'red' ? 'background:#b91c1c;color:#fff;' : 'background:#dcfce7;color:#000;';
      return `<tr><td colspan="${COLS}" style="padding:8px 10px;${bg}">
        <div style="font-size:19px;font-weight:800;">${esc(l.text)}</div>
        <div style="font-size:13px;margin-top:2px;">${esc(l.hint)}</div>
      </td></tr>`;
    }
    case 'rollHead':
      return head([
        ['№', '5%', 'center'],
        ['Рулон', '17%'],
        ['Материал', '25%'],
        ['Остаток', '17%', 'right'],
        ['Без дела', '17%', 'center'],
        ['Кто кроил', '19%'],
      ]);
    case 'roll': {
      const r = l.roll;
      const qty = `<b style="font-size:17px;">${fmtQty(r.remainingQuantity)}</b> ${esc(r.unit)}${
        r.opened ? `<div style="font-size:12px;color:#444;">из ${fmtQty(r.initialQuantity)}</div>` : ''
      }`;
      const state = r.pendingAcceptance
        ? '<div style="font-size:12px;font-weight:800;color:#92400e;">В ПУТИ</div>'
        : !r.opened
          ? '<div style="font-size:12px;font-weight:800;">НЕ ОТКРЫТ</div>'
          : '';
      const last = r.lastUsedAt
        ? `<div style="font-size:12px;color:#444;margin-top:3px;">резали ${fmtDate(new Date(r.lastUsedAt))}</div>`
        : `<div style="font-size:12px;color:#444;margin-top:3px;">${r.opened ? 'резка не записана' : 'ещё не резали'}</div>`;
      return `<tr>${td(String(l.n), 'center', 'font-size:13px;color:#444;')}${td(
        `<span style="font-family:monospace;font-size:18px;font-weight:800;">${esc(r.barcode)}</span>${state}`,
      )}${td(esc(r.materialName), 'left', 'font-weight:700;')}${td(qty, 'right')}${td(
        idleBadge(r.idleHours) + last,
        'center',
      )}${td(esc(cuttersText(r.cutters)), 'left', 'font-size:14px;')}</tr>`;
    }
    case 'matHead':
      return head([
        ['Материал', '36%'],
        ['Рулонов', '12%', 'center'],
        ['Остаток', '18%', 'right'],
        ['Застряло 7+ сут', '17%', 'center'],
        ['Дольше всех', '17%', 'center'],
      ]);
    case 'mat':
      return `<tr>${td(esc(l.name), 'left', 'font-weight:700;')}${td(String(l.total), 'center')}${td(
        `<b>${fmtQty(l.qty)}</b> ${esc(l.unit)}`,
        'right',
      )}${td(
        l.stuck ? String(l.stuck) : '—',
        'center',
        l.stuck ? 'font-size:18px;font-weight:800;color:#b91c1c;' : '',
      )}${td(fmtIdle(l.maxIdle), 'center')}</tr>`;
    case 'empty':
      return `<tr><td colspan="${COLS}" style="padding:8px;font-size:16px;color:#444;">${esc(l.text)}</td></tr>`;
  }
};

export const shiftKey = (wid: number, shift: number | null) => `${wid}-${shift ?? 'x'}`;

const byIdleDesc = (a: ReportRoll, b: ReportRoll) => (b.idleHours ?? 0) - (a.idleHours ?? 0);

const buildLines = (rolls: ReportRoll[], shifts: ReportShift[], showWorkshop: boolean): Line[] => {
  const lines: Line[] = [];

  shifts.forEach((s) => {
    const mine = rolls.filter((r) => shiftKey(r.workshopId, r.shiftNumber) === shiftKey(s.workshopId, s.shiftNumber));
    if (mine.length === 0) return;
    const stuck = mine.filter((r) => (r.idleHours ?? 0) >= STUCK_HOURS).sort(byIdleDesc);
    const fresh = mine.filter((r) => (r.idleHours ?? 0) < STUCK_HOURS).sort(byIdleDesc);
    if (showWorkshop) lines.push({ kind: 'title', text: `${s.workshopName} · ${s.shiftLabel}` });
    lines.push({
      kind: 'alert',
      stuck: stuck.length,
      unopened: mine.filter((r) => !r.opened && !r.pendingAcceptance).length,
      total: mine.length,
    });
    let n = 0;
    lines.push({
      kind: 'group',
      text: `ЗАСТРЯЛИ: без дела 7 суток и больше — ${stuck.length} рул.`,
      hint: 'Сверху — кто лежит дольше всех',
      tone: 'red',
    });
    if (stuck.length) {
      lines.push({ kind: 'rollHead' });
      stuck.forEach((r) => lines.push({ kind: 'roll', roll: r, n: ++n }));
    } else lines.push({ kind: 'empty', text: 'Таких рулонов нет' });
    lines.push({
      kind: 'group',
      text: `В РАБОТЕ: без дела меньше 7 суток — ${fresh.length} рул.`,
      hint: 'Жёлтая плашка — не трогали больше суток',
      tone: 'green',
    });
    if (fresh.length) {
      lines.push({ kind: 'rollHead' });
      fresh.forEach((r) => lines.push({ kind: 'roll', roll: r, n: ++n }));
    } else lines.push({ kind: 'empty', text: 'Таких рулонов нет' });
  });

  const mats = new Map<number, MatLine>();
  rolls.forEach((r) => {
    const m =
      mats.get(r.materialId) ||
      { kind: 'mat' as const, name: r.materialName, unit: r.unit, total: 0, qty: 0, stuck: 0, fresh: 0, maxIdle: null };
    m.total += 1;
    m.qty += r.remainingQuantity;
    if ((r.idleHours ?? 0) >= STUCK_HOURS) m.stuck += 1;
    else m.fresh += 1;
    m.maxIdle = Math.max(m.maxIdle ?? 0, r.idleHours ?? 0);
    mats.set(r.materialId, m);
  });
  const list = [...mats.values()];
  const freshList = list.filter((m) => m.fresh > 0).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const allList = [...list].sort((a, b) => b.stuck - a.stuck || a.name.localeCompare(b.name, 'ru'));

  lines.push({ kind: 'title', text: 'Все материалы смены', sub: 'сверху — где больше застрявших' });
  lines.push({ kind: 'matHead' });
  allList.forEach((m) => lines.push(m));

  lines.push({ kind: 'title', text: 'Материалы в работе (меньше 7 суток)', sub: `${freshList.length} шт.` });
  if (freshList.length) {
    lines.push({ kind: 'matHead' });
    freshList.forEach((m) => lines.push(m));
  } else lines.push({ kind: 'empty', text: 'За последнюю неделю ни с одним материалом не работали' });

  return lines;
};

/** Режем по высоте листа; шапку таблицы повторяем на новом листе. */
const paginate = (lines: Line[]) => {
  const pages: Line[][] = [];
  let cur: Line[] = [];
  let used = 0;
  let lastHead: Line | null = null;
  lines.forEach((l, i) => {
    if (l.kind === 'rollHead' || l.kind === 'matHead') lastHead = l;
    if (l.kind === 'title' || l.kind === 'group') lastHead = null;
    // Заголовок раздела не оставляем одиноко внизу: с ним должны уйти хотя бы шапка и строка.
    const next = lines[i + 1];
    const keep = l.kind === 'title' || l.kind === 'group' || l.kind === 'rollHead' || l.kind === 'matHead'
      ? (next ? lineHeight(next) : 0) + 60
      : 0;
    const h = lineHeight(l);
    if (cur.length && used + h + keep > PAGE_BUDGET_PX) {
      pages.push(cur);
      cur = [];
      used = 0;
      if ((l.kind === 'roll' || l.kind === 'mat') && lastHead) {
        cur.push(lastHead);
        used += lineHeight(lastHead);
      }
    }
    cur.push(l);
    used += h;
  });
  if (cur.length) pages.push(cur);
  return pages;
};

const ROLL_COLS = ['5%', '17%', '25%', '17%', '17%', '19%'];
const MAT_COLS = ['36%', '12%', '18%', '17%', '17%'];

/** Каждая строка — своя таблица (у рулонов и материалов разные колонки), поэтому ширины задаём явно. */
const colgroup = (l: Line) => {
  const cols = l.kind === 'roll' || l.kind === 'rollHead' ? ROLL_COLS : l.kind === 'mat' || l.kind === 'matHead' ? MAT_COLS : null;
  return cols ? `<colgroup>${cols.map((w) => `<col style="width:${w}"/>`).join('')}</colgroup>` : '';
};

const pageHtml = (lines: Line[], title: string, pageNo: number, pages: number) =>
  `<div style="width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;box-sizing:border-box;padding:24px 26px;font-family:Arial,Helvetica,sans-serif;background:#fff;color:#000;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #000;padding-bottom:8px;">
      <div>
        <div style="font-size:26px;font-weight:800;">${esc(title)}</div>
        <div style="font-size:15px;margin-top:2px;">Простой рулонов в цехе</div>
      </div>
      <div style="font-size:15px;text-align:right;font-weight:700;">${fmtDate(new Date())}<br/><span style="font-weight:400;">лист ${pageNo} из ${pages}</span></div>
    </div>
    ${lines
      .map((l) => `<table style="width:100%;border-collapse:collapse;table-layout:fixed;">${colgroup(l)}${renderLine(l)}</table>`)
      .join('')}
  </div>`;

export const renderPage = async (pdf: jsPDFType, html: string, first: boolean) => {
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

export const translit = (v: string) => {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
    л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return v
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * PDF о простое рулонов — ОТДЕЛЬНЫЙ ФАЙЛ НА КАЖДУЮ СМЕНУ: лист отдают старшему
 * смены, и чужие рулоны в нём только мешают. В каждом файле: рулоны смены
 * (застрявшие 7+ суток сверху), список материалов смены и материалы, с которыми
 * смена работала за последние 7 суток.
 *
 * Данные берутся одним запросом, дальше файлы собираются в браузере.
 * Возвращает число сформированных файлов.
 */
export const printWorkshopRollsReport = async (shifts: ReportShift[], workshopId?: number) => {
  const url = workshopId ? `${WORKSHOP_MATERIALS_URL}?report=1&workshop_id=${workshopId}` : `${WORKSHOP_MATERIALS_URL}?report=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось получить рулоны');
  const data = (await res.json()) as { rolls: ReportRoll[] };
  const all = data.rolls || [];
  const { default: jsPDF } = await import('jspdf');
  const date = fmtDate(new Date()).replace(/\./g, '-');

  let made = 0;
  for (const s of shifts) {
    const key = shiftKey(s.workshopId, s.shiftNumber);
    const rolls = all.filter((r) => shiftKey(r.workshopId, r.shiftNumber) === key);
    if (rolls.length === 0) continue;
    const title = `${s.workshopName} · ${s.shiftLabel}`;
    const pages = paginate(buildLines(rolls, [s], false));
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    for (let i = 0; i < pages.length; i++) {
      await renderPage(pdf, pageHtml(pages[i], title, i + 1, pages.length), i === 0);
    }
    // Браузер режет пачку скачиваний подряд — даём паузу между файлами.
    if (made > 0) await wait(600);
    pdf.save(`prostoy-${translit(s.workshopName)}-${translit(s.shiftLabel)}-${date}.pdf`);
    made += 1;
  }
  if (made === 0) throw new Error('В выбранных сменах нет рулонов');
  return made;
};

export default printWorkshopRollsReport;
