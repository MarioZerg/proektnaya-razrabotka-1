import { useEffect, useState } from 'react';

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

const sizeClasses: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-20 w-20 text-2xl',
};

interface ChatAvatarProps {
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** Человек сейчас в чате — рисуем зелёную точку. */
  online?: boolean;
  /** Своё фото: по нажатию его можно сменить. */
  onClick?: () => void;
  /** Подпись при наведении вместо имени (для своего фото — «Сменить фото»). */
  title?: string;
}

/**
 * Фото сотрудника в чате.
 *
 * Показываем фото из профиля — по лицу человека узнают быстрее, чем по инициалам,
 * а в переписке двух Лен и трёх Наташ это единственный способ понять, кто кому
 * ответил. Если фото нет или ссылка на него протухла (сменил аватар в мессенджере,
 * удалил профиль), рисуем кружок с буквами: пустое место выглядело бы как сбой.
 */
const ChatAvatar = ({ name, url, size = 'sm', online, onClick, title }: ChatAvatarProps) => {
  const [failed, setFailed] = useState(false);

  // Человек сменил фото — старая ссылка больше не при чём, ошибку сбрасываем.
  // Иначе после смены фото на его месте навсегда оставались бы инициалы.
  useEffect(() => setFailed(false), [url]);

  const box = sizeClasses[size];
  const inner =
    url && !failed ? (
      <img
        src={url}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`${box} rounded-full bg-muted object-cover`}
      />
    ) : (
      <div
        className={`${box} flex items-center justify-center rounded-full font-bold text-white ${avatarColor(name)}`}
      >
        {initials(name)}
      </div>
    );

  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      title={title || name}
      className={`relative shrink-0 rounded-full ${
        onClick ? 'group transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring' : ''
      }`}
    >
      {inner}
      {online && (
        // Точка «в сети»: обводка цветом фона, иначе на тёмной фотографии она
        // сливается с краем кружка и её не видно.
        <span
          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-500"
          aria-label="в сети"
        />
      )}
    </Tag>
  );
};

export default ChatAvatar;
