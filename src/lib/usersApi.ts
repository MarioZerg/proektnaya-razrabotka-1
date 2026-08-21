import type { Role } from '@/lib/roles';

const USERS_URL = 'https://functions.poehali.dev/1db3a89a-f0f6-470e-bef4-fb5ca8fa02df';

export interface UserRoleEntry {
  role: Role;
  isApproved: boolean;
}

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
  /** График работы: 2/2 — смена 12 часов, 5/2 — пятидневка. */
  workSchedule: string | null;
  /** Сколько минут опоздания прощается до штрафа. */
  lateToleranceMinutes: number;
  workHours: number | null;
  avatarUrl: string | null;
  isActive: boolean;
  /** Договор расторгнут: доступ закрыт, аккаунт и история сохранены. */
  contractTerminatedAt?: string | null;
  /** Сотрудник подписал Акт о расторжении — ждёт решения администратора. */
  terminationPending?: boolean;
  /** Сколько сканов загружено из трёх: паспорт, прописка, СНИЛС. */
  docsCount?: number;
  /** Администратор сверил паспортные данные со сканом. */
  passportVerified?: boolean;
  /** Номер телефона для выплат по СБП. */
  sbpPhone?: string | null;
  /** Реквизиты для выплат подтверждены администратором. */
  sbpConfirmed?: boolean;
  /** Когда сотрудник прислал полный комплект документов. */
  docsSubmittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  shiftNumber: number | null;
  maxUserId: string | null;
  phone: string | null;
  registeredViaMax: boolean;
  /** Гостевой режим ("смена выключена" сотруднику) — не привязан жёстко к штатной смене,
   * при открытии смены сам выбирает цех/смену на сегодня. */
  shiftFree: boolean;
  /** Когда сотруднику откроется зарплата (новичкам — через 2 недели). */
  salaryUnlockAt: string | null;
  /** Сколько дней осталось до открытия зарплаты, 0 — уже открыта. */
  salaryDaysLeft: number;
  roles: UserRoleEntry[];
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
  workSchedule?: string;
  lateToleranceMinutes?: number;
  workHours?: number | null;
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
    workSchedule: string | null;
    lateToleranceMinutes: number;
  workHours: number | null;
    isActive: boolean;
    avatarBase64: string;
    maxUserId: string | null;
    shiftNumber: number | null;
    shiftFree: boolean;
  }>
) => postAction({ action: 'update', id, ...fields });

export const deleteEmployee = (id: number) => postAction({ action: 'delete', id });

export const addEmployeeRole = (id: number, role: Role, approved = true) =>
  postAction({ action: 'add_role', id, role, approved });

/** Открывает сотруднику зарплату досрочно, не дожидаясь двух недель — для опытных
 * работников, которых берут сразу в дело. */
export const unlockEmployeeSalary = (id: number) =>
  postAction({ action: 'unlock_salary', id, actorRole: 'admin' }) as Promise<{
    success: true;
    fullName: string;
  }>;

/** Утверждает должность сотрудника и заодно задаёт ему пароль для входа по логину.
 * Возвращает логин — админ диктует сотруднику логин с паролем. */
export const approveEmployeeRole = (
  id: number,
  role: Role,
  password?: string
): Promise<{ success: true; login: string | null }> =>
  postAction({ action: 'approve_role', id, role, ...(password ? { password } : {}) });

export const removeEmployeeRole = (id: number, role: Role) =>
  postAction({ action: 'remove_role', id, role });

/** Отклоняет заявку новичка: убирает запрошенную должность и отключает учётную запись,
 * если других должностей у него нет. Сам сотрудник остаётся в общем списке. */
export const rejectEmployeeRole = (id: number, role: Role) =>
  postAction({ action: 'reject_role', id, role });