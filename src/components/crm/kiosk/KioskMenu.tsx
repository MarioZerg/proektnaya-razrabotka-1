import Icon from '@/components/ui/icon';

export type KioskScreen =
  | 'menu'
  | 'shift'
  | 'orders'
  | 'reviews'
  | 'rolls'
  | 'unlabeled'
  | 'repack';

interface KioskMenuProps {
  onSelect: (screen: KioskScreen) => void;
  /** Роль сотрудника — кладовщику на терминале доступны смена и поиск вещей без стикера. */
  role: string;
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
    screen: 'repack',
    label: 'Перепаковка',
    icon: 'PackageOpen',
    className: 'bg-violet-500 hover:bg-violet-600 text-white',
  },
];

/** Главное меню терминала — крупные плитки под сенсорный экран. */
const KioskMenu = ({ onSelect, role }: KioskMenuProps) => {
  // Кладовщик на терминале открывает смену и ищет вещи, оставшиеся без стикера хранения.
  // «Товар без стикера» — его зона ответственности, остальным эта плитка не нужна.
  // «Перепаковка» — вещи, вернувшиеся от покупателя годными, но с мятой упаковкой:
  // их переупаковывает упаковщик, кладовщику эта плитка не нужна.
  const visibleTiles =
    role === 'storekeeper'
      ? tiles.filter((t) => t.screen === 'shift' || t.screen === 'unlabeled')
      : tiles.filter((t) => t.screen !== 'unlabeled');

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