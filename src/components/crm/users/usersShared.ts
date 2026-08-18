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