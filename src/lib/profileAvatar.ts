/** Одна и та же заглушка, если сотрудник не поставил фото в профиль. */
export const PROFILE_AVATAR_PLACEHOLDER = '/assets/avatar-placeholder.svg';

/**
 * Своё фото профиля.
 *
 * Снимок из мессенджера сюда не входит: его могли записать на чужую карточку.
 * Своё — то, что загрузили в систему (наш CDN) или выбрали в форме (data:).
 */
const ownProfilePhoto = (url: string): string | null => {
  if (url.startsWith('data:image/')) return url;
  try {
    if (new URL(url).hostname === 'cdn.poehali.dev') return url;
  } catch {
    return null;
  }
  return null;
};

/** Адрес для кружка: своё фото или общая заглушка. */
export const profileAvatarSrc = (url?: string | null): string => {
  const value = url?.trim() || '';
  return (value && ownProfilePhoto(value)) || PROFILE_AVATAR_PLACEHOLDER;
};
