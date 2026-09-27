import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { ReturnGiveout } from '@/lib/returnCodesApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface GiveoutListProps {
  giveouts: ReturnGiveout[];
  listLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onWatch: (giveoutId: number | null) => void;
}

/** Что ждёт получения в пункте выдачи. */
const GiveoutList = ({
  giveouts,
  listLoading,
  error = null,
  onRetry,
  onWatch,
}: GiveoutListProps) => (
  <div className="space-y-2">
    <h2 className="text-base font-bold">Ожидают получения в пункте выдачи</h2>
    {error && onRetry && (
      <WarehouseFetchError
        title="Не удалось загрузить выдачи"
        description={error}
        onRetry={onRetry}
      />
    )}
    {listLoading && giveouts.length === 0 ? (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка…
      </div>
    ) : giveouts.length === 0 ? (
      error ? null : (
      <p className="text-sm text-muted-foreground">
        Сейчас в пунктах выдачи ничего не ждёт — забирать нечего
      </p>
      )
    ) : (
      giveouts.map((g) => (
        <Card key={g.giveoutId} className="border-emerald-300 bg-emerald-50 shadow-none">
          <CardContent className="space-y-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-emerald-900">{g.placeName}</p>
                {g.status && <p className="text-sm text-emerald-800">{g.status}</p>}
              </div>
              <p className="shrink-0 text-lg font-bold text-emerald-900">{g.count} шт.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => onWatch(g.giveoutId)}
            >
              <Icon name="ScanLine" size={14} className="mr-1" />
              Следить за приёмкой
            </Button>
          </CardContent>
        </Card>
      ))
    )}
  </div>
);

export default GiveoutList;