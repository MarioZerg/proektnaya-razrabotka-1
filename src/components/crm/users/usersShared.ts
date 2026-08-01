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

export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

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
  salary: string;
  shiftFrom: string;
  shiftTo: string;
  newPassword: string;
  avatarBase64: string;
  maxUserId: string;
}