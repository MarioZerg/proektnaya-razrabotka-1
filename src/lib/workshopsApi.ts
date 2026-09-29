const WORKSHOPS_URL = 'https://functions.poehali.dev/c3ce83da-9296-40d9-b00b-720d364431ea';

/** POEHALI: цеха. FRONTEND-ONLY: сбой GET не писать как «цехов нет». */

/** Закрытые цеха: производство осталось только в первом. */
export const RETIRED_WORKSHOP_NAMES = ['Цех №2', 'Тестовый цех (QA)'] as const;

export const isRetiredWorkshop = (w: { id?: number | null; name?: string | null }) =>
  w.id === 2 || (!!w.name && (RETIRED_WORKSHOP_NAMES as readonly string[]).includes(w.name));

export interface Workshop {
  id: number;
  name: string;
  isActive: boolean;
  shiftsCount: number;
  employeesCount: number;
  createdAt: string;
  updatedAt: string;
  shiftNames: string[];
  /** Материалы, разрешённые цеху — по ним фильтруются заявки и списки в интерфейсе. */
  allowedMaterials: number[];
}

export interface WorkshopShift {
  number: number;
  employeesCount: number;
}

export interface SettingField {
  value: string | null;
  global: string | null;
}

export interface WorkshopDetail {
  id: number;
  name: string;
  isActive: boolean;
  shiftsCount: number;
  allowedProducts: number[];
  allowedMaterials: number[];
  createdAt: string;
  updatedAt: string;
  shifts: WorkshopShift[];
  settings: Record<string, SettingField>;
}

export const fetchWorkshops = async (): Promise<Workshop[]> => {
  const res = await fetch(WORKSHOPS_URL);
  const data = await res.json();
  return ((data.workshops || []) as Workshop[]).filter((w) => !isRetiredWorkshop(w));
};

export const fetchWorkshopDetail = async (id: number): Promise<WorkshopDetail> => {
  if (isRetiredWorkshop({ id })) {
    throw new Error('Этот цех закрыт');
  }
  const res = await fetch(`${WORKSHOPS_URL}?id=${id}`);
  const data = await res.json();
  if (!data.workshop || isRetiredWorkshop(data.workshop)) {
    throw new Error(data.error || 'Цех не найден');
  }
  return data.workshop;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(WORKSHOPS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const createWorkshop = (name: string, shiftsCount = 1) =>
  postAction({ action: 'create', name, shiftsCount });

export const updateWorkshop = (
  id: number,
  fields: Partial<{
    name: string;
    shiftsCount: number;
    isActive: boolean;
    allowedProducts: number[];
    allowedMaterials: number[];
    settings: Record<string, string | null>;
  }>
) => postAction({ action: 'update', id, ...fields });

export const deleteWorkshop = (id: number) => postAction({ action: 'delete', id });