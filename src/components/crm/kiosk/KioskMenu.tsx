import Icon from '@/components/ui/icon';
import { isStorekeeperRole, type Role } from '@/lib/roles';

export type KioskScreen =
  | 'menu'
  | 'shift'
  | 'orders'
  | 'reviews'
  | 'rolls'
  | 'unlabeled'
  | 'defect'
  | 'defect-receive'
  | 'repack';

interface KioskMenuProps {
  onSelect: (screen: KioskScreen) => void;
  /** Роль сотрудника — кладовщику на терминале доступны смена и поиск вещей без стикера. */
  role: Role;
}

const tiles: Array<{ screen: KioskScreen; label: string; icon: string; className: string }> = [
  {
    screen: 'shift',
    label: 'Открытие / Закрытие смены',
    icon: 'Clock',
    className: 'bg-blue-500 hover:bg-blue-600 text-white',
  },
  {
    screen: 'orders',
    label: 'Печать заказов',
    icon: 'Printer',
    className: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  },
  {
    screen: 'reviews',
    label: 'Отзывы',
    icon: 'Star',
    className: 'bg-orange-500 hover:bg-orange-600 text-white',
  },
  {
    screen: 'rolls',
    label: 'Работа с рулонами',
    icon: 'Scroll',
    className: 'bg-amber-400 hover:bg-amber-500 text-black',
  },
  {
    screen: 'unlabeled',
    label: 'Товар без стикера',
    icon: 'PackageSearch',
    className: 'bg-rose-500 hover:bg-rose-600 text-white',
  },
  {
    screen: 'defect',
    label: 'Брак из рулона',
    icon: 'PackageX',
    className: 'bg-red-600 hover:bg-red-700 text-white',
  },
  {
    screen: 'defect-receive',
    label: 'Приём брака из цеха',
    icon: 'PackageX',
    className: 'bg-red-600 hover:bg-red-700 text-white',
  },
  {
    screen: 'repack',
    label: 'Перепаковка',
    icon: 'PackageOpen',
    className: 'bg-violet-500 hover:bg-violet-600 text-white',
  },
];

/** Главное меню терминала — крупные плитки под сенсорный экран. */
const KioskMenu = ({ onSelect, role }: KioskMenuProps) => {
  // Кто что видит на терминале:
  //
  // «Товар без стикера» и «Приём брака» — зона кладовщика: он ищет вещи, оставшиеся без
  //   стикера хранения, и забирает брак из контейнеров цеха на склад.
  // «Перепаковка» — вещи вернулись от покупателя годными, но с мятой упаковкой. Их
  //   переупаковывает ТОЛЬКО упаковщица: швея и закройщик упаковкой не занимаются, и
  //   лишняя плитка на их экране мешает.
  // «Брак из рулона» — видят все, кто работает с материалом, но каждый по своему:
  //   закройщик режет ткань, швея шьёт тесьмой, упаковщица портит пакеты и этикетки.
  // «Отзывы» — доступны всем ролям на терминале.
  const hiddenByRole: Record<string, KioskScreen[]> = {
    storekeeper: ['orders', 'rolls', 'defect', 'repack'],
    sewer: ['unlabeled', 'defect-receive', 'repack'],
    cutter: ['unlabeled', 'defect-receive', 'repack'],
  };

  const hidden = isStorekeeperRole(role)
    ? hiddenByRole.storekeeper
    : hiddenByRole[role] || ['unlabeled', 'defect-receive'];

  const visibleTiles = tiles.filter((t) => !hidden.includes(t.screen));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleTiles.map((t) => (
        <button
          key={t.screen}
          onClick={() => onSelect(t.screen)}
          className={`flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-xl p-6 text-center transition ${t.className}`}
        >
          <Icon name={t.icon} size={48} />
          <span className="text-xl font-bold">{t.label}</span>
        </button>
      ))}
    </div>
  );
};

export default KioskMenu;