import { roleLabels, type Role } from '@/lib/roles';

export const roleOptions = Object.keys(roleLabels) as Role[];
export const workshopOptions = ['Цех №1'];

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * «Коротаева Наталья Александровна» → «Коротаева Н.А.»
 *
 * На телефоне полное ФИО обрезалось или ломалось по буквам. Фамилия + инициалы
 * имени и отчества помещаются в строку у всех сотрудников; полное ФИО — в title.
 */
export const shortName = (fullName: string) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const [last, first, middle] = parts;
  const fioInitials = [first, middle]
    .filter(Boolean)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join('');
  return fioInitials ? `${last} ${fioInitials}` : last;
};

export { formatDateTime } from '@/lib/dateUtils';

export const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export interface CreateFormState {
  fullName: string;
  email: string;
  role: Role;
  password: string;
  workshop: string;
  avatarBase64: string;
}

export const emptyCreateForm: CreateFormState = {
  fullName: '',
  email: '',
  role: 'sewer',
  password: '',
  workshop: 'Цех №1',
  avatarBase64: '',
};

export interface CardFormState {
  fullName: string;
  role: Role;
  workshop: string;
  shiftFrom: string;
  shiftTo: string;
  /** График работы: '2/2', '5/2' или пусто, если не задан. */
  workSchedule: string;
  /** Допустимое опоздание в минутах (строкой — поле ввода). */
  lateToleranceMinutes: string;
  workHours: string;
  newPassword: string;
  avatarBase64: string;
  maxUserId: string;
  /** Швея допущена к работе на оверлоке — видит вкладку «Оверлок» на конвейере. */
  canOverlock: boolean;
  /** Дата выхода на работу, ГГГГ-ММ-ДД. */
  hiredAt: string;
}