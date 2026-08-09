import func2url from '../../backend/func2url.json';

const CLEANUP_URL = (func2url as Record<string, string>)['system-cleanup'];

export interface TableCount {
  table: string;
  label: string;
  count: number;
}

export interface CleanupGroup {
  key: string;
  title: string;
}

export interface CleanupInfo {
  counts: TableCount[];
  groups: CleanupGroup[];
  /** Слово, которое админ вводит руками для подтверждения. */
  confirmPhrase: string;
}

export const fetchCleanupInfo = async (actorId: number): Promise<CleanupInfo> => {
  const res = await fetch(`${CLEANUP_URL}?actorId=${actorId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить данные');
  return data;
};

export const runCleanup = async (payload: {
  actorId: number;
  groups: string[];
  confirm: string;
}): Promise<{
  success: true;
  removed: { table: string; removed: number }[];
  counts: TableCount[];
}> => {
  const res = await fetch(CLEANUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить очистку');
  return data;
};
