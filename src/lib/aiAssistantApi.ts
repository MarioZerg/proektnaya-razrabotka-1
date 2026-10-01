import type { Role } from '@/lib/roles';

const AI_ASSISTANT_URL = 'https://functions.poehali.dev/c6f2fe80-681d-438f-85c6-f30503927ede';

/** Сообщение в переписке с помощником. */
export interface AiMessageFile {
  name: string;
  size?: number;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Когда написали — чтобы в сохранённой истории были часы. */
  at?: number;
  /** Имена файлов, которые человек приложил к этому сообщению. */
  files?: AiMessageFile[];
  /** Извлечённый текст документов — в пузыре не показываем, в историю модели кладём. */
  docExcerpt?: string;
  /** Суточная сводка маркетплейсов — агент прислал сам, не ответ на вопрос. */
  kind?: 'news';
  /** Календарный день сводки по Москве YYYY-MM-DD — чтобы не дублировать. */
  digestDay?: string;
}

export interface AiAnswer {
  answer: string;
  /** Запросы, которые помощник сделал к базе — показываем по кнопке «Подробнее». */
  queries?: string[];
  model?: string;
  docExcerpt?: string;
  /** Суточная сводка: новостей нет, в чат ничего не кладём. */
  quiet?: boolean;
}

/** Файл, который уходит в облачную функцию: имя, тип и base64. */
export interface AiUpload {
  name: string;
  mime: string;
  data: string;
  size: number;
}

/** Закреплённый вопрос: живёт отдельно от переписки, очистка чата его не трогает. */
export interface AiNote {
  id: string;
  savedAt: number;
  question: string;
  answer: string;
}

/** Имя для обращения: «Иванов Иван Иванович» → Иван, «Андрей» → Андрей. */
export const givenName = (full?: string): string => {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length >= 3) return parts[1];
  if (parts.length === 2) {
    if (/(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкая)$/i.test(parts[0])) {
      return parts[1];
    }
    return parts[0];
  }
  return parts[0];
};

export const CHAT_FILE_MAX_BYTES = 2_000_000;
export const CHAT_FILE_MAX_COUNT = 3;
export const CHAT_FILE_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.jpg,.jpeg,.png,.webp,.gif';

const CHAT_FILE_EXT = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf',
  'jpg', 'jpeg', 'png', 'webp', 'gif',
]);

const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();

const mimeOf = (file: File) => {
  if (file.type) return file.type;
  const ext = extOf(file.name);
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'txt') return 'text/plain';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'application/octet-stream';
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });

const compressImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1600;
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const scale = Math.min(max / w, max / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось сжать фото'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть изображение'));
    };
    img.src = url;
  });

/** Готовит файлы к отправке: проверка типа и размера, фото сжимаем. */
export const prepareChatUploads = async (
  incoming: File[],
  already: number,
): Promise<{ uploads: AiUpload[]; error: string | null }> => {
  const room = CHAT_FILE_MAX_COUNT - already;
  if (room <= 0) {
    return { uploads: [], error: `Можно приложить не больше ${CHAT_FILE_MAX_COUNT} файлов` };
  }
  const picked = incoming.slice(0, room);
  const uploads: AiUpload[] = [];
  for (const file of picked) {
    const ext = extOf(file.name);
    if (!CHAT_FILE_EXT.has(ext)) {
      return {
        uploads: [],
        error: `«${file.name}» не читаю. Нужны PDF, Word, Excel, текст или фото.`,
      };
    }
    if (file.size > CHAT_FILE_MAX_BYTES) {
      return {
        uploads: [],
        error: `«${file.name}» слишком тяжёлый — до ${Math.round(CHAT_FILE_MAX_BYTES / 1_000_000)} МБ`,
      };
    }
    const isImage = file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    const dataUrl = isImage ? await compressImage(file) : await fileToDataUrl(file);
    const comma = dataUrl.indexOf(',');
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    uploads.push({
      name: file.name.slice(0, 180),
      mime: isImage ? 'image/jpeg' : mimeOf(file),
      data,
      size: file.size,
    });
  }
  if (incoming.length > room) {
    return {
      uploads,
      error: `Взял ${room} из ${incoming.length}: за раз не больше ${CHAT_FILE_MAX_COUNT} файлов`,
    };
  }
  return { uploads, error: null };
};

/**
 * Спросить МЕГАБУХ: учёт, кадры, 1С, СБИС, Диадок, Точка, маркетплейсы.
 * Производственную базу агент не читает. Файлы — текущий ход, не вся история.
 */
export const askAiAssistant = async (
  question: string,
  userId: number,
  history: AiMessage[] = [],
  role?: Role,
  files: AiUpload[] = [],
): Promise<AiAnswer> => {
  const res = await fetch(AI_ASSISTANT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      userId,
      history: history.map(({ role: r, content, docExcerpt }) => ({
        role: r,
        content:
          r === 'user' && docExcerpt
            ? `${content}\n\n---\nТекст документов из того сообщения:\n${docExcerpt}`
            : content,
      })),
      role,
      files: files.map(({ name, mime, data }) => ({ name, mime, data })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Помощник не ответил');
  return data;
};

const DIGEST_QUESTION =
  'Сводка новостей маркетплейсов за сегодня: OZON, Wildberries, Яндекс Маркет. '
  + 'Только свежие официальные изменения для бухгалтера продавца. Если новостей нет — NO_NEWS.';

/**
 * Раз в сутки: МЕГАБУХ сам обходит новости кабинетов продавца.
 * Историю чата не передаём — это не продолжение диалога.
 */
export const askMegabuhDigest = async (
  userId: number,
  role?: Role,
): Promise<AiAnswer> => {
  const res = await fetch(AI_ASSISTANT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: DIGEST_QUESTION,
      userId,
      history: [],
      role,
      mode: 'marketplace_digest',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Сводка маркетплейсов не пришла');
  return data;
};
