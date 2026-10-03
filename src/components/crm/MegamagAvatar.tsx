/**
 * Аватар МЕГАМАГ — живой менеджер витрины в чате.
 */
const MegamagAvatar = ({
  size = 32,
  className = '',
  idleFlip = false,
}: {
  size?: number;
  className?: string;
  /** В шапке чата: раз в 10 секунд переворачивается кругом. */
  idleFlip?: boolean;
}) => (
  <img
    src="/assets/megamag-avatar.jpg"
    alt="МЕГАМАГ"
    width={size}
    height={size}
    className={`shrink-0 rounded-full object-cover object-top shadow-sm ${
      idleFlip ? 'animate-megabuh-flip [transform-style:preserve-3d]' : ''
    } ${className}`}
    style={{ width: size, height: size }}
  />
);

export default MegamagAvatar;
