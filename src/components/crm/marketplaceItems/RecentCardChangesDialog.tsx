import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import { fetchRecentCardChanges, type RecentCardChange } from '@/lib/marketplaceItemsApi';

interface Props {
  shopId: number | null;
  shopName?: string;
}

const MP_LABEL: Record<RecentCardChange['marketplace'], string> = { ozon: 'OZON', wildberries: 'WB' };
const DAYS = 30;

/** Скачивает список как CSV — открывается в Excel. */
const downloadCsv = (rows: RecentCardChange[], shopName: string) => {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Изменена', 'Площадка', 'Артикул', 'Код площадки', 'Название', 'Новая'].map(esc).join(';'),
    ...rows.map((r) =>
      [formatDateTime(r.updatedAt), MP_LABEL[r.marketplace], r.article, r.code, r.name, r.isNew ? 'да' : '']
        .map(esc)
        .join(';')
    ),
  ];
  // BOM в начале — чтобы Excel открыл кириллицу без «кракозябр».
  const blob = new Blob([String.fromCharCode(0xfeff), lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `изменения-карточек-${shopName}-${DAYS}дн.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/**
 * Какие карточки менялись на площадках за 30 дней.
 *
 * API площадок отдают только дату последнего изменения: кто и что именно
 * поменял, не узнать. Дата сдвигается от любой правки — в кабинете, нашими
 * выгрузками цен или самой площадкой.
 */
const RecentCardChangesDialog = ({ shopId, shopName = '' }: Props) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RecentCardChange[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = async () => {
    if (!shopId) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const d = await fetchRecentCardChanges(shopId, DAYS);
      setRows(d.items);
      setWarnings(d.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось получить изменения');
    } finally {
      setLoading(false);
    }
  };

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.marketplace] = (acc[r.marketplace] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Button variant="outline" onClick={load} disabled={!shopId}>
        <Icon name="History" size={16} className="mr-1.5" />
        Изменения за {DAYS} дней
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Карточки, изменённые за {DAYS} дней{shopName ? ` · ${shopName}` : ''}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Площадки отдают только дату последнего изменения карточки — кто и что поменял, через API не видно.
            Дата сдвигается от любой правки: в кабинете, нашими выгрузками цен или самой площадкой.
            Яндекс Маркет такую дату не отдаёт.
          </p>
          {loading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Запрашиваем карточки у площадок — до минуты…
            </p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  Всего {rows.length}
                  {Object.entries(counts).map(([mp, n]) => ` · ${MP_LABEL[mp as RecentCardChange['marketplace']]} ${n}`)}
                </p>
                {rows.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => downloadCsv(rows, shopName)}>
                    <Icon name="Download" size={14} className="mr-1" />
                    Скачать CSV
                  </Button>
                )}
              </div>
              {warnings.length > 0 && <p className="text-xs text-amber-700">{warnings.join('; ')}</p>}
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">За {DAYS} дней карточки не менялись.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Изменена</th>
                        <th className="px-3 py-2 font-medium">Площадка</th>
                        <th className="px-3 py-2 font-medium">Артикул</th>
                        <th className="px-3 py-2 font-medium">Название</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={`${r.marketplace}-${r.article}-${r.code}`} className="border-t border-border">
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(r.updatedAt)}</td>
                          <td className="px-3 py-2">{MP_LABEL[r.marketplace]}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {r.article || '—'}
                            {r.isNew && (
                              <Badge variant="outline" className="ml-2">
                                новая
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2">{r.name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default RecentCardChangesDialog;
