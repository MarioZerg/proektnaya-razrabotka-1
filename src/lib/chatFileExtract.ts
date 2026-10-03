/**
 * Извлечение текста из вложений чата на устройстве.
 * Тяжёлые отчёты (до 20 МБ) нельзя слать base64 в облачную функцию —
 * шлюз режет тело запроса ~3.5 МБ. Отправляем только текст.
 */

export const CHAT_DOC_CHARS = 40_000;

const xmlLocal = (tag: string) => {
  const i = tag.indexOf('}');
  return i >= 0 ? tag.slice(i + 1) : tag;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Браузер не умеет распаковывать ZIP');
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
};

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/** Читает файлы из ZIP (store / deflate). Нужны только XML из xlsx/docx. */
const unzipEntries = async (buf: ArrayBuffer): Promise<Map<string, Uint8Array>> => {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const out = new Map<string, Uint8Array>();
  let o = 0;
  while (o + 30 <= bytes.length) {
    if (u32(view, o) !== 0x04034b50) break;
    const method = u16(view, o + 8);
    const compSize = u32(view, o + 18);
    const nameLen = u16(view, o + 26);
    const extraLen = u16(view, o + 28);
    const nameStart = o + 30;
    const name = new TextDecoder('utf-8').decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);
    o = dataStart + compSize;
    if (name.endsWith('/')) continue;
    try {
      if (method === 0) {
        out.set(name, compressed.slice());
      } else if (method === 8) {
        out.set(name, await inflateRaw(compressed));
      }
    } catch {
      // Один битый entry не роняет весь отчёт.
    }
  }
  return out;
};

const parseXml = (data: Uint8Array) => {
  const text = new TextDecoder('utf-8').decode(data);
  return new DOMParser().parseFromString(text, 'application/xml');
};

const xlsxText = async (buf: ArrayBuffer): Promise<string> => {
  const zip = await unzipEntries(buf);
  const shared: string[] = [];
  const ss = zip.get('xl/sharedStrings.xml');
  if (ss) {
    const doc = parseXml(ss);
    for (const si of Array.from(doc.getElementsByTagName('*'))) {
      if (xmlLocal(si.tagName) !== 'si') continue;
      let s = '';
      for (const t of Array.from(si.getElementsByTagName('*'))) {
        if (xmlLocal(t.tagName) === 't') s += t.textContent || '';
      }
      shared.push(s);
    }
  }
  const sheets = [...zip.keys()]
    .filter((n) => n.startsWith('xl/worksheets/sheet') && n.endsWith('.xml'))
    .sort();
  const rowsOut: string[] = [];
  for (const sheetName of sheets.slice(0, 8)) {
    const raw = zip.get(sheetName);
    if (!raw) continue;
    rowsOut.push(`Лист ${sheetName.split('/').pop()}:`);
    const doc = parseXml(raw);
    for (const row of Array.from(doc.getElementsByTagName('*'))) {
      if (xmlLocal(row.tagName) !== 'row') continue;
      const cells: string[] = [];
      for (const c of Array.from(row.children)) {
        if (xmlLocal(c.tagName) !== 'c') continue;
        const t = c.getAttribute('t') || '';
        let v = '';
        for (const child of Array.from(c.children)) {
          if (xmlLocal(child.tagName) === 'v') v = child.textContent || '';
        }
        if (t === 's' && /^\d+$/.test(v) && Number(v) < shared.length) {
          cells.push(shared[Number(v)]);
        } else if (t === 'inlineStr') {
          let s = '';
          for (const n of Array.from(c.getElementsByTagName('*'))) {
            if (xmlLocal(n.tagName) === 't') s += n.textContent || '';
          }
          if (s) cells.push(s);
        } else if (v) {
          cells.push(v);
        }
      }
      if (cells.length) rowsOut.push(cells.join(' | '));
      if (rowsOut.join('\n').length > CHAT_DOC_CHARS) break;
    }
    if (rowsOut.join('\n').length > CHAT_DOC_CHARS) break;
  }
  return rowsOut.join('\n').slice(0, CHAT_DOC_CHARS);
};

const docxText = async (buf: ArrayBuffer): Promise<string> => {
  const zip = await unzipEntries(buf);
  const xml = zip.get('word/document.xml');
  if (!xml) return '';
  const doc = parseXml(xml);
  const paras: string[] = [];
  for (const p of Array.from(doc.getElementsByTagName('*'))) {
    if (xmlLocal(p.tagName) !== 'p') continue;
    let line = '';
    for (const t of Array.from(p.getElementsByTagName('*'))) {
      if (xmlLocal(t.tagName) === 't') line += t.textContent || '';
    }
    line = line.trim();
    if (line) paras.push(line);
    if (paras.join('\n').length > CHAT_DOC_CHARS) break;
  }
  return paras.join('\n').slice(0, CHAT_DOC_CHARS);
};

const pdfText = async (buf: ArrayBuffer): Promise<string> => {
  const loadPdfjs = (await import('@/lib/pdfjs')).default;
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  const pages = Math.min(pdf.numPages, 40);
  for (let i = 1; i <= pages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) parts.push(line);
    if (parts.join('\n').length > CHAT_DOC_CHARS) break;
  }
  return parts.join('\n').slice(0, CHAT_DOC_CHARS);
};

const plainText = async (file: File): Promise<string> => {
  const text = await file.text();
  return text.slice(0, CHAT_DOC_CHARS);
};

/**
 * Достаёт текст из отчёта/документа. Пустая строка — не удалось.
 */
export const extractChatFileText = async (file: File): Promise<string> => {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === 'xlsx') return xlsxText(buf);
  if (ext === 'docx') return docxText(buf);
  if (ext === 'pdf') return pdfText(buf);
  if (ext === 'csv' || ext === 'txt' || ext === 'rtf') return plainText(file);
  if (ext === 'xls' || ext === 'doc') {
    return (
      `Старый формат .${ext}. Сохраните файл в .xlsx / .docx или CSV и приложите снова.`
    );
  }
  return '';
};
