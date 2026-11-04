import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fetchRecentCardChanges, type RecentCardChange } from '@/lib/marketplaceItemsApi';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: number | null;
  shopName?: string;
}

type Filter = 'all' | 'OZON' | 'WB';

const fmt = (iso: string) => {
  if (!iso) return '—';
  const d = new Date(`${iso}Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

const csvCell = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const RecentCardChangesDialog = ({ open, onOpenChange, shopId, shopName }: Props) => {
  const [items, setItems] = useState<RecentCardChange[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!open || !shopId) return;
    setLoading(true);
    setError('');
    fetchRecentCardChanges(shopId, 30)
      .then((r) => {
        setItems(r.items);
        setWarnings(r.warnings);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false));
  }, [open, shopId]);

  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.marketplace === filter)),
    [items, filter],
  );
  const counts = useMemo(
    () => ({
      all: items.length,
      OZON: items.filter((i) => i.marketplace === 'OZON').length,
      WB: items.filter((i) => i.marketplace === 'WB').length,
    }),
    [items],
  );

  const downloadCsv = () => {
    const head = ['Площадка', 'Артикул', 'Код площадки', 'Название', 'Изменена', 'Создана'];
    const lines = shown.map((i) =>
      [i.marketplace, i.article, i.code, i.name, fmt(i.updatedAt), fmt(i.createdAt)]
        .map(csvCell)
        .join(';'),
    );
    const blob = new Blob([`\uFEFF${[head.map(csvCell).join(';'), ...lines].join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `izmeneniya-kartochek-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Изменения карточек за 30 дней</DialogTitle>
          <DialogDescription>
            Карточки OZON и WB{shopName ? ` магазина «${shopName}»` : ''}, которые менялись за
            последние 30 дней. Дата — последнее изменение по данным площадки.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Icon name="Loader2" size={20} className="animate-spin" />
            Запрашиваю карточки у площадок…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'OZON', 'WB'] as Filter[]).map((f) => (
                  <Button
                    key={f}
                    size="sm"
                    variant={filter === f ? 'default' : 'outline'}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'Все' : f}: {counts[f]}
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!shown.length}>
                <Icon name="Download" size={14} className="mr-1.5" />
                Скачать CSV
              </Button>
            </div>

            {warnings.map((w) => (
              <p key={w} className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {w}
              </p>
            ))}

            {shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                За 30 дней карточки не менялись
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Изменена</th>
                      <th className="px-3 py-2">Площадка</th>
                      <th className="px-3 py-2">Артикул</th>
                      <th className="px-3 py-2">Название</th>
                      <th className="px-3 py-2">Код</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => (
                      <tr key={`${i.marketplace}-${i.code}-${i.article}`} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-2">{fmt(i.updatedAt)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-semibold text-white ${
                              i.marketplace === 'OZON' ? 'bg-blue-600' : 'bg-fuchsia-700'
                            }`}
                          >
                            {i.marketplace}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{i.article}</td>
                        <td className="px-3 py-2">{i.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                          {i.code}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RecentCardChangesDialog;
