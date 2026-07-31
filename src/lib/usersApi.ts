import type { Role } from '@/lib/roles';

const USERS_URL = 'https://functions.poehali.dev/1db3a89a-f0f6-470e-bef4-fb5ca8fa02df';

export interface Employee {
  id: number;
  login: string;
  email: string | null;
  fullName: string;
  role: Role;
  workshop: string | null;
  salary: number;
  shiftFrom: string | null;
  shiftTo: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const fetchEmployees = async (): Promise<Employee[]> => {
  const res = await fetch(USERS_URL);
  const data = await res.json();
  return data.users || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(USERS_URL, {
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

export const createEmployee = (payload: {
  fullName: string;
  email: string;
  role: Role;
  password: string;
  workshop?: string;
  salary?: number;
  shiftFrom?: string;
  shiftTo?: string;
  avatarBase64?: string;
}) => postAction({ action: 'create', ...payload });

export const updateEmployee = (
  id: number,
  fields: Partial<{
    fullName: string;
    role: Role;
    password: string;
    workshop: string;
    salary: number;
    shiftFrom: string | null;
    shiftTo: string | null;
    isActive: boolean;
    avatarBase64: string;
  }>
) => postAction({ action: 'update', id, ...fields });

export const deleteEmployee = (id: number) => postAction({ action: 'delete', id });
