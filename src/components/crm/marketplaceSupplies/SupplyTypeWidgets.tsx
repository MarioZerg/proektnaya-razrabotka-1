import { useState } from 'react';
import Icon from '@/components/ui/icon';
import LiveCountBoard from '@/components/crm/LiveCountBoard';
import type { Supply, SupplyType } from '@/lib/marketplaceSuppliesApi';

/**
 * Плашки по схемам поставки — те же карточки, что станции склада товара.
 *
 * Сверху иллюстрация, снизу название и табло с числом поставок. При наведении
 * карточка приподнимается, картинка чуть приближается: видно, что это кнопка.
 * Клик фильтрует таблицу, повторный клик снимает фильтр.
 */

type Group = {
  type: SupplyType;
  title: string;
  subtitle: string;
  image: string;
  /** На узком кадре держим в кадре человека, а не пустой край. */
  position: string;
  tone: 'violet' | 'cyan';
};

const GROUPS: Group[] = [
  {
    type: 'FBS',
    title: 'FBS',
    subtitle: 'Со своего склада — вещь едет клиенту',
    image: '/warehouse-stations/supply-fbs-white-fabric.jpg',
    position: 'object-left',
    tone: 'cyan',
  },
  {
    type: 'FBO',
    title: 'FBO',
    subtitle: 'Коробами на склад маркетплейса для хранения и дальнейшей продажи',
    image: '/warehouse-stations/supply-fbo-warehouse.jpg',
    position: 'object-center',
    tone: 'violet',
  },
];

const suppliesWord = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'поставка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'поставки';
  return 'поставок';
};

const SupplyTypeWidgets = ({
  supplies,
  activeType,
  onSelectType,
}: {
  supplies: Supply[];
  /** Текущий фильтр по схеме: подсвечиваем выбранную плашку. */
  activeType: string;
  onSelectType: (type: string) => void;
}) => {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {GROUPS.map((g) => (
        <SupplySchemeCard
          key={g.type}
          group={g}
          supplies={supplies.filter((s) => s.type === g.type)}
          active={activeType === g.type}
          onSelect={() => onSelectType(activeType === g.type ? 'all' : g.type)}
        />
      ))}
    </div>
  );
};

const SupplySchemeCard = ({
  group,
  supplies,
  active,
  onSelect,
}: {
  group: Group;
  supplies: Supply[];
  active: boolean;
  onSelect: () => void;
}) => {
  const [pressed, setPressed] = useState(false);
  const items = supplies.reduce((sum, s) => sum + (s.itemsCount || 0), 0);
  const assembling = supplies.filter((s) => s.status === 'На сборке').length;
  const locked = supplies.filter((s) => s.lockedByName).length;
  const alive = supplies.length > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      aria-pressed={active}
      aria-label={`${group.title}: ${supplies.length}`}
      className={`group flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#f7f4ee] text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        pressed ? 'scale-[0.98]' : ''
      } ${
        active
          ? 'ring-2 ring-primary'
          : alive
            ? group.tone === 'cyan'
              ? 'border-cyan-300'
              : 'border-violet-200'
            : 'border-border'
      }`}
    >
      <div className="relative h-40 w-full overflow-hidden bg-[#f4efe6] sm:aspect-video sm:h-auto">
        <img
          src={group.image}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${group.position}`}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight">
              {group.title}
              {active && (
                <span className="ml-2 rounded-sm bg-primary px-1.5 py-0.5 align-middle text-[11px] font-medium text-primary-foreground">
                  фильтр
                </span>
              )}
            </p>
            <p className="mt-1 text-xs leading-tight text-muted-foreground">{group.subtitle}</p>
          </div>
          <LiveCountBoard value={supplies.length} tone={group.tone} />
        </div>
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            {suppliesWord(supplies.length)}
            <span className="mx-1.5">·</span>
            товаров: <span className="font-semibold text-foreground">{items} шт</span>
          </p>
          {assembling > 0 && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Icon name="Boxes" size={13} />
              На сборке: <span className="font-semibold text-foreground">{assembling}</span>
            </p>
          )}
          {locked > 0 && (
            <p className="flex items-center gap-1.5 text-amber-700">
              <Icon name="Lock" size={13} />
              Заняты другими: {locked}
            </p>
          )}
        </div>
      </div>
    </button>
  );
};

export default SupplyTypeWidgets;
