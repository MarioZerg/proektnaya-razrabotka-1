import { profileAvatarSrc } from '@/lib/profileAvatar';

/** Лицо на телевизоре: своё фото профиля или общая заглушка. */
export const personFaceUrl = (person: {
  id: number;
  avatarUrl?: string | null;
}): string => profileAvatarSrc(person.avatarUrl);
