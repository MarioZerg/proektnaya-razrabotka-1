const ROLL_AUDITS_URL = 'https://functions.poehali.dev/f107f17f-0fe7-41d9-9e53-9171792b00be';

export interface RollAudit {
  id: number;
  status: 'in_progress' | 'done' | 'cancelled';
  startedByName: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  finishedByName: string | null;
  expected: number;
  found: number;
  missing: number;
}

export interface RollAuditMissing {
  rollId: number;
  barcode: string;
  material: string;
  unit: string;
  remaining: number;
  since: string | null;
}

export interface RollAuditDetail {
  audit: RollAudit;
  /** Стикеры, засчитанные в сверку. */
  found: string[];
  missing: RollAuditMissing[];
}

/** Старт сверки: весь список «числится на складе» приходит один раз, дальше всё в браузере. */
export interface RollAuditSession {
  audit: RollAudit;
  expected: RollAuditMissing[];
  found: string[];
}

const parse = async <T>(res: Response): Promise<T> => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || data.errorMessage) throw new Error(data.error || data.errorMessage || 'Ошибка сверки');
  return data as T;
};

const post = <T>(body: Record<string, unknown>) =>
  fetch(ROLL_AUDITS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => parse<T>(r));

export const fetchRollAudits = () =>
  fetch(ROLL_AUDITS_URL).then((r) => parse<{ audits: RollAudit[] }>(r)).then((d) => d.audits);

export const fetchRollAudit = (id: number) =>
  fetch(`${ROLL_AUDITS_URL}?id=${id}`).then((r) => parse<RollAuditDetail>(r));

export const startRollAudit = () => post<RollAuditSession>({ action: 'start' });
export const saveRollAuditScans = (id: number, barcodes: string[]) =>
  post<{ saved: string[] }>({ action: 'scan', id, barcodes });
export const finishRollAudit = (id: number) => post<{ success: boolean }>({ action: 'finish', id });
export const cancelRollAudit = (id: number) => post<{ success: boolean }>({ action: 'cancel', id });
