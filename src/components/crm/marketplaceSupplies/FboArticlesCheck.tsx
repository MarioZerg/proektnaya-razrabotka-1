import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { FboArticleRow } from '@/lib/marketplaceSuppliesApi';

interface FboArticlesCheckProps {
  rows: FboArticleRow[];
  /** Перечитать короба с сервера — после того как лишнее убрали. */
  onRefresh?: () => Promise<void> | void;
}

const diffOf = (r: FboArticleRow) => r.inBoxes - r.planned;

/**
 * Сверка поставки FBO по артикулам: по заявке / в коробах / разница.
 *
 * Общий счётчик «215 из 215» прячет пересорт: лишняя штука одного артикула
 * закрывает недостачу другого, а OZON принимает по каждому отдельно и
 * берёт деньги за обработку. Сверху — проблемные строки (перебор красным,
 * недобор жёлтым), совпавшие свёрнуты, чтобы не мешали.
 */
const FboArticlesCheck = ({ rows, onRefresh }: FboArticlesCheckProps) => {
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const { problems, ok, over, under } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const da = diffOf(a);
      const db = diffOf(b);
      if ((da > 0) !== (db > 0)) return da > 0 ? -1 : 1;
      return Math.abs(db) - Math.abs(da) || (a.offerId || '').localeCompare(b.offerId || '');
    });
    return {
      problems: sorted.filter((r) => diffOf(r) !== 0),
      ok: sorted.filter((r) => diffOf(r) === 0),
      over: rows.filter((r) => diffOf(r) > 0).reduce((s, r) => s + diffOf(r), 0),
      under: rows.filter((r) => diffOf(r) < 0).reduce((s, r) => s - diffOf(r), 0),
    };
  }, [rows]);

  const hasOver = over > 0;
  // Сверка нужна, только пока в коробах есть лишнее. Убрали излишки —
  // после обновления блок пропадает, чтобы не отвлекал от сборки.
  if (!rows.length || !hasOver) return null;

  const visible = showAll ? [...problems, ...ok] : problems;

  return (
    <Card className={`shadow-none ${hasOver ? 'border-destructive/50' : 'border-border'}`}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="ListChecks" size={18} className="text-muted-foreground" />
            <span className="font-semibold">Сверка по артикулам</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {onRefresh && (
              <Button variant="outline" size="sm" className="h-7" onClick={refresh} disabled={refreshing}>
                <Icon
                  name={refreshing ? 'Loader2' : 'RefreshCw'}
                  size={13}
                  className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                Обновить сверку
              </Button>
            )}
            {hasOver && (
              <span className="rounded-md bg-destructive/10 px-2 py-1 font-medium text-destructive">
                Лишнее: {over} шт.
              </span>
            )}
            {under > 0 && (
              <span className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-900">
                Не хватает: {under} шт.
              </span>
            )}
            {!hasOver && under === 0 && (
              <span className="rounded-md bg-emerald-100 px-2 py-1 font-medium text-emerald-800">
                Всё по заявке
              </span>
            )}
          </div>
        </div>

        {hasOver && (
          <p className="text-sm text-destructive">
            В коробах больше, чем в заявке. На OZON это излишек и пересорт — найдите лишние штуки
            в коробах и уберите их до закрытия.
          </p>
        )}

        {visible.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Артикул</th>
                  <th className="px-3 py-2 text-right font-medium">Заявка</th>
                  <th className="px-3 py-2 text-right font-medium">В коробах</th>
                  <th className="px-3 py-2 text-right font-medium">Разница</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const d = diffOf(r);
                  const tone =
                    d > 0 ? 'bg-destructive/5 text-destructive' : d < 0 ? 'bg-amber-50 text-amber-900' : '';
                  return (
                    <tr key={`${r.itemId ?? 'none'}-${r.offerId ?? ''}`} className={`border-t ${tone}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.offerId || 'Без артикула'}</div>
                        {r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.planned}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.inBoxes}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {d === 0 ? '✓' : d > 0 ? `+${d}` : d}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {ok.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            <Icon name={showAll ? 'ChevronUp' : 'ChevronDown'} size={14} className="mr-1.5" />
            {showAll ? 'Скрыть совпавшие' : `Показать совпавшие (${ok.length})`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default FboArticlesCheck;
