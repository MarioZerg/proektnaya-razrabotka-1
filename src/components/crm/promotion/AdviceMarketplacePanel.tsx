import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import PriceAdviceTable from '@/components/crm/promotion/PriceAdviceTable';
import type { OverviewResponse, PriceAdvice } from '@/lib/promotionApi';

interface AdviceMarketplacePanelProps {
  summary: OverviewResponse['summary'] | undefined;
  items: PriceAdvice[];
  selected: Set<number>;
  loading: boolean;
  busy: boolean;
  onToggle: (itemId: number) => void;
  onToggleAll: () => void;
  onPushOpen: () => void;
  onDecide: (decision: 'applied' | 'skipped') => void;
}

/**
 * Советы по одной площадке: сводка, предупреждение про рекламу и сама таблица.
 *
 * Здесь же панель массовых действий — она появляется, только когда что-то
 * выбрано, чтобы не занимать место в обычном режиме просмотра.
 */
const AdviceMarketplacePanel = ({
  summary: s,
  items,
  selected,
  loading,
  busy,
  onToggle,
  onToggleAll,
  onPushOpen,
  onDecide,
}: AdviceMarketplacePanelProps) => (
  <>
    {s && (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Поднять цену</p>
          <p className="text-2xl font-bold text-emerald-700">{s.raise}</p>
          <p className="text-xs text-muted-foreground">маржа ниже цели</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Снизить цену</p>
          <p className="text-2xl font-bold text-amber-700">{s.lower}</p>
          <p className="text-xs text-muted-foreground">цена завышена</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">В норме</p>
          <p className="text-2xl font-bold">{s.hold}</p>
          <p className="text-xs text-muted-foreground">трогать не нужно</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Реклама съедает</p>
          <p className="text-2xl font-bold">{s.avgAdPercent ?? 0}%</p>
          <p className="text-xs text-muted-foreground">от цены в среднем</p>
        </div>
      </div>
    )}

    {/* Эти товары прибыльны сами по себе — их топит только реклама.
        Поднимать им цену бесполезно: надо выключать бустинг. */}
    {!!s?.killedByAds && s.killedByAds > 0 && (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
        <Icon
          name="TriangleAlert"
          size={16}
          className="mt-0.5 shrink-0 text-amber-700"
        />
        <div className="text-sm">
          <p className="font-medium text-amber-900">
            {s.killedByAds} позиций убыточны только из-за рекламы
          </p>
          <p className="text-amber-800">
            Без продвижения они были бы в плюсе. Поднимать цену тут
            бесполезно — выгоднее отключить им рекламу в кабинете
            площадки
          </p>
        </div>
      </div>
    )}

    {selected.size > 0 && (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <span className="text-sm font-medium">Выбрано: {selected.size}</span>
        {/* Главное действие: система сама меняет цену на витрине.
            Раньше приходилось идти в кабинет площадки руками. */}
        <Button size="sm" onClick={onPushOpen} disabled={busy}>
          <Icon name="Upload" size={14} className="mr-1.5" />
          Изменить цены на площадке
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDecide('applied')}
          disabled={busy}
        >
          <Icon name="Check" size={14} className="mr-1.5" />
          Уже менял сам
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onDecide('skipped')}
          disabled={busy}
        >
          <Icon name="X" size={14} className="mr-1.5" />
          Не буду менять
        </Button>
      </div>
    )}

    {loading ? (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Считаем советы…
      </div>
    ) : (
      <PriceAdviceTable
        items={items}
        selected={selected}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />
    )}
  </>
);

export default AdviceMarketplacePanel;
