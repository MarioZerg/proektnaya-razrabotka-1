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
 * «Привезенцева Елена Александровна» -> «Привезенцева Елена А.»
 *
 * Раньше в списке оставляли только «Е. А.», и по одной букве не отличить Елену
 * от Екатерины. Имя показываем целиком, отчество — инициалом: строка короче
 * полного ФИО, но человека всё ещё узнают. Фамилию и имя можно перенести,
 * а «Елена А.» держим вместе неразрывным пробелом.
 */
export const shortName = (fullName: string) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return fullName || '';
  const patronymicInitial = `${parts[2][0].toUpperCase()}.`;
  return `${parts[0]} ${parts[1]}\u00a0${patronymicInitial}`;
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
  /** Швея допущена к работе на оверлоке — видит вкладку «Оверлок» на конвейере. */
  canOverlock: boolean;
}