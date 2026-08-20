const LOGS_URL = 'https://functions.poehali.dev/76b45ef0-dcd6-43ae-bafe-a568bb09547a';

/** Этап работы — по нему админ фильтрует журнал: «покажи всё про пошив». */
export type LogStage = 'shifts' | 'cutting' | 'sewing' | 'stickering';

export const stageLabels: Record<LogStage, string> = {
  shifts: 'Смены',
  cutting: 'Раскрой',
  sewing: 'Пошив',
  stickering: 'Стикеровка и склад',
};

export const stageIcons: Record<LogStage, string> = {
  shifts: 'CalendarClock',
  cutting: 'Scissors',
  sewing: 'Shirt',
  stickering: 'Package',
};

export interface LogEvent {
  at: string;
  userId: number | null;
  who: string;
  action: string;
  actionTitle: string;
  entityType: string | null;
  entityId: number | null;
  description: string;
  category: string;
  workshop: string | null;
  role: string | null;
}

export interface LogFilters {
  stage?: LogStage | '';
  userId?: number | '';
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LogsResult {
  items: LogEvent[];
  total: number;
}

export interface LogSummary {
  shiftsOpened: number;
  shiftsClosed: number;
  cut: number;
  taken: number;
  sewn: number;
  packed: number;
}

const buildParams = (filters?: LogFilters) => {
  const params = new URLSearchParams();
  if (filters?.stage) params.set('stage', filters.stage);
  if (filters?.userId) params.set('userId', String(filters.userId));
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  return params;
};

export const fetchLogEvents = async (filters?: LogFilters): Promise<LogsResult> => {
  const params = buildParams(filters);
  params.set('action', 'events');
  const res = await fetch(`${LOGS_URL}?${params.toString()}`);
  const data = await res.json();
  return { items: data.items || [], total: data.total || 0 };
};

export const fetchLogSummary = async (filters?: LogFilters): Promise<LogSummary> => {
  const params = buildParams(filters);
  params.set('action', 'summary');
  const res = await fetch(`${LOGS_URL}?${params.toString()}`);
  return res.json();
};

export const fetchLogUsers = async (): Promise<{ id: number; name: string }[]> => {
  const res = await fetch(`${LOGS_URL}?action=users`);
  const data = await res.json();
  return data.users || [];
};
