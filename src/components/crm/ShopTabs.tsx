import Icon from '@/components/ui/icon';
import type { Shop } from '@/lib/marketplaceIntegrationsApi';

interface ShopTabsProps {
  shops: Shop[];
  /** Выбранный магазин; null — показываем все магазины сразу. */
  value: number | null;
  onChange: (shopId: number | null) => void;
  /** Сколько карточек в каждом магазине: id магазина -> количество. */
  counts?: Record<number, number>;
  /** Показывать ли вкладку «Все магазины». */
  allowAll?: boolean;
  allLabel?: string;
}

/**
 * Переключатель магазинов: МЕГАТЮЛЬ и ДЮНА.
 *
 * Кабинеты на площадках у магазинов разные, ассортимент тоже — карточки одного
 * магазина не должны попадаться на глаза, когда работают с другим: перепутанный
 * товар уедет в чужую поставку. Поэтому список товаров всегда открыт на
 * конкретном магазине, а не общей кучей.
 *
 * Пока магазин один, вкладки не рисуем: выбор из одного пункта — просто шум.
 */
const ShopTabs = ({
  shops,
  value,
  onChange,
  counts,
  allowAll = false,
  allLabel = 'Все магазины',
}: ShopTabsProps) => {
  if (shops.length < 2) return null;

  const totalCount = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0)
    : undefined;

  const tabClass = (active: boolean) =>
    `flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-border bg-background text-muted-foreground hover:bg-muted'
    }`;

  const countClass = (active: boolean) =>
    `rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
      active ? 'bg-primary-foreground/20' : 'bg-muted'
    }`;

  return (
    <div className="flex flex-wrap gap-2 border-b border-border pb-3">
      {allowAll && (
        <button type="button" onClick={() => onChange(null)} className={tabClass(value === null)}>
          <Icon name="LayoutGrid" size={15} />
          {allLabel}
          {totalCount !== undefined && (
            <span className={countClass(value === null)}>{totalCount}</span>
          )}
        </button>
      )}
      {shops.map((shop) => {
        const active = shop.id === value;
        return (
          <button
            key={shop.id}
            type="button"
            onClick={() => onChange(shop.id)}
            className={tabClass(active)}
          >
            <Icon name="Store" size={15} />
            {shop.name}
            {counts && <span className={countClass(active)}>{counts[shop.id] ?? 0}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default ShopTabs;
