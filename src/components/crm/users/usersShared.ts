import { roleLabels, type Role } from '@/lib/roles';

export const roleOptions = Object.keys(roleLabels) as Role[];
export const workshopOptions = ['Цех №1', 'Цех №2'];

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

/**
 * «Привезенцева Елена Александровна» -> «Привезенцева Е. А.»
 *
 * Полное ФИО в списке не помещалось в строку и переносилось на вторую, из-за чего
 * карточки прыгали по высоте, а на телефоне имя обрывалось многоточием. Фамилия
 * важнее отчества: по ней администратор и ищет человека, поэтому её оставляем
 * целиком, а имя с отчеством сокращаем до инициалов.
 */
export const shortName = (fullName: string) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return fullName || '';
  const rest = parts
    .slice(1, 3)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join('\u00a0');
  // Неразрывный пробел между фамилией и инициалами: иначе «Е. А.» отрывается
  // от фамилии и уезжает на следующую строку.
  return `${parts[0]}\u00a0${rest}`;
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
  workshop: '',
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
}