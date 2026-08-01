const LOGS_URL = 'https://functions.poehali.dev/236734c3-d32a-4920-b0c1-0e2e176f7425';

export type LogCategory = 'production' | 'warehouse' | 'finance';

export const logCategoryLabels: Record<LogCategory, string> = {
  production: 'Заказы и производство',
  warehouse: 'Склад и материалы',
  finance: 'Финансы',
};

export interface LogEntry {
  id: number;
  createdAt: string;
  userId: number | null;
  userName: string | null;
  category: LogCategory;
  action: string;
  entityType: string | null;
  entityId: number | null;
  description: string;
  details: Record<string, unknown> | null;
}

export interface LogFilters {
  category?: LogCategory;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface LogsResult {
  entries: LogEntry[];
  total: number;
}

export const fetchLogs = async (filters?: LogFilters): Promise<LogsResult> => {
  const params = new URLSearchParams();
  if (filters?.category) params.set('category', filters.category);
  if (filters?.userId) params.set('user_id', String(filters.userId));
  if (filters?.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters?.dateTo) params.set('date_to', filters.dateTo);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();
  const res = await fetch(qs ? `${LOGS_URL}?${qs}` : LOGS_URL);
  const data = await res.json();
  return { entries: data.entries || [], total: data.total || 0 };
};
