const ERRORS_URL = 'https://functions.poehali.dev/387b8a08-1e19-4eec-8fcb-2e3821463956';

export interface AppErrorItem {
  id: number;
  at: string | null;
  source: string | null;
  level: string | null;
  message: string;
  stack: string | null;
  page: string | null;
  userName: string | null;
  userRole: string | null;
  userAgent: string | null;
  appVersion: string | null;
}

export interface AppErrorSummaryRow {
  message: string;
  count: number;
  lastAt: string | null;
  users: number;
}

const readJson = async (res: Response) => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Сервер ответил ошибкой ${res.status}`);
  return data;
};

export const fetchAppErrors = async (search: string, limit: number): Promise<AppErrorItem[]> => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search.trim()) params.set('search', search.trim());
  const data = await readJson(await fetch(`${ERRORS_URL}?${params.toString()}`));
  return data.items || [];
};

export const fetchAppErrorSummary = async (): Promise<AppErrorSummaryRow[]> => {
  const data = await readJson(await fetch(`${ERRORS_URL}?summary=1`));
  return data.summary || [];
};
