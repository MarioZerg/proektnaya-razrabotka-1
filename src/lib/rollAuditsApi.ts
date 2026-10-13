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
  extra: number;
}

export interface RollAuditScan {
  barcode: string;
  rollId: number | null;
  /** ok — числится на складе; extra — по учёту не на складе; unknown — стикера нет в системе. */
  result: 'ok' | 'extra' | 'unknown';
  rollStatus: string | null;
  material: string | null;
  remaining: number | null;
  by: string | null;
  at: string | null;
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
  scans: RollAuditScan[];
  missing: RollAuditMissing[];
  last?: { barcode: string; result: RollAuditScan['result']; duplicate: boolean; material: string | null; rollStatus: string | null };
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

export const startRollAudit = () => post<RollAuditDetail>({ action: 'start' });
export const scanRollAudit = (id: number, barcode: string) => post<RollAuditDetail>({ action: 'scan', id, barcode });
export const finishRollAudit = (id: number) => post<RollAuditDetail>({ action: 'finish', id });
export const cancelRollAudit = (id: number) => post<{ success: boolean }>({ action: 'cancel', id });
