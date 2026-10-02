/**
 * Аватар МЕГАМАГ — агент кабинетов маркетплейсов у менеджера.
 */
import Icon from '@/components/ui/icon';

const MegamagAvatar = ({ size = 32, className = '' }: { size?: number; className?: string }) => (
  <div
    className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-700 text-white shadow-sm ${className}`}
    style={{ width: size, height: size }}
    aria-hidden
  >
    <Icon name="Store" size={Math.round(size * 0.46)} />
  </div>
);

export default MegamagAvatar;
