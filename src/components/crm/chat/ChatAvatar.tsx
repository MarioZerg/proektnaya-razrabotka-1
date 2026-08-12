import { useState } from 'react';

/** Цвет кружка — по имени, чтобы собеседники различались с одного взгляда. */
const avatarColor = (name: string) => {
  const colors = [
    'bg-violet-500',
    'bg-emerald-500',
    'bg-sky-500',
    'bg-amber-500',
    'bg-rose-500',
    'bg-teal-500',
  ];
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return colors[sum % colors.length];
};

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

interface ChatAvatarProps {
  name: string;
  url?: string | null;
}

/**
 * Фото сотрудника в чате.
 *
 * Показываем фото из профиля (загруженное админом или взятое из MAX) — по лицу
 * человека узнают быстрее, чем по инициалам. Если фото нет или ссылка на него
 * протухла (сменил аватар в мессенджере, удалил профиль), рисуем кружок с буквами:
 * пустое место на его месте выглядело бы как сбой.
 */
const ChatAvatar = ({ name, url }: ChatAvatarProps) => {
  const [failed, setFailed] = useState(false);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-full bg-muted object-cover"
      />
    );
  }

  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(name)}`}
      title={name}
    >
      {initials(name)}
    </div>
  );
};

export default ChatAvatar;
