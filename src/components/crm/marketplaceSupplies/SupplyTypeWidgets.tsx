import { useState } from 'react';
import SceneImage from '@/components/crm/SceneImage';
import LiveCountBoard from '@/components/crm/LiveCountBoard';
import type { Supply, SupplyType } from '@/lib/marketplaceSuppliesApi';

/**
 * Плашки FBS и FBO: крупная картинка схемы и число поставок.
 * Клик фильтрует список, повторный клик снимает фильтр.
 */

type Group = {
  type: SupplyType;
  title: string;
  subtitle: string;
  image: string;
  tone: 'violet' | 'cyan';
};

const GROUPS: Group[] = [
  {
    type: 'FBS',
    title: 'FBS',
    subtitle: 'Со своего склада — вещь едет клиенту',
    image: 'supply-fbs-white-fabric',
    tone: 'cyan',
  },
  {
    type: 'FBO',
    title: 'FBO',
    subtitle: 'Коробами на склад маркетплейса',
    image: 'supply-fbo-warehouse',
    tone: 'violet',
  },
];

const SupplyTypeWidgets = ({
  supplies,
  activeType,
  onSelectType,
}: {
  supplies: Supply[];
  activeType: string;
  onSelectType: (type: string) => void;
}) => (
  <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
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

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      aria-pressed={active}
      className={`flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-[#f7f4ee] text-left sm:flex-row ${
        pressed ? 'scale-[0.99]' : ''
      } ${active ? 'ring-2 ring-primary' : group.tone === 'cyan' ? 'border-cyan-300' : 'border-violet-200'}`}
    >
      {/* Кадр одного размера на всех ширинах: не растягивается вместе с колонкой. */}
      <div className="relative h-36 w-full shrink-0 overflow-hidden bg-[#f4efe6] sm:h-full sm:w-40 sm:min-h-[7.5rem]">
        <SceneImage name={group.image} sizes="160px" className="object-center" />
      </div>
      <div className="flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold leading-tight">{group.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{group.subtitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            товаров: <span className="font-semibold text-foreground">{items} шт</span>
          </p>
        </div>
        <LiveCountBoard value={supplies.length} tone={group.tone} size="sm" />
      </div>
    </button>
  );
};

export default SupplyTypeWidgets;
