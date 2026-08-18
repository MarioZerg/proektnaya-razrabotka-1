import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchDefectHistory, type DefectHistoryRow } from '@/lib/kioskApi';
import { roleLabels, formatQty, formatDate } from './defectShared';

/**
 * Вкладка «Принятый брак».
 *
 * Таблица со всеми принятыми кусками: кто сдал, из какого рулона и материала,
 * сколько и из какой поставки пришла ткань. Фильтр по датам и итог по выборке —
 * чтобы предъявить поставщику претензию за партию, а не разбирать записи по одной.
 */
const DefectReceivedTab = () => {
  const [rows, setRows] = useState<DefectHistoryRow[]>([]);
  const [totalQuantity, setTotalQuantity] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Поиск по сотруднику, материалу, рулону и поставщику — сразу по всей таблице.
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    fetchDefectHistory(
      dateFrom || dateTo ? { dateFrom, dateTo } : { days: 90 },
    )
      .then((d) => {
        setRows(d.items);
        setTotalQuantity(d.totalQuantity);
      })
      .catch(() => {
        setRows([]);
        setTotalQuantity(0);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [dateFrom, dateTo]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.userName, r.materialName, r.rollBarcode, r.supplierName, r.barcode, r.reasonLabel]
        .some((v) => (v || '').toLowerCase().includes(q)),
    );
  }, [rows, search]);

  // Итог показываем по видимым строкам: если человек отфильтровал по поставщику,
  // ему нужна сумма именно по нему, а не по всему периоду.
  const visibleQty = useMemo(
    () => visible.reduce((s, r) => s + r.quantity, 0),
    [visible],
  );

  const unit = rows[0]?.unit || 'м';

  return (
    <div className="space-y-4">
      <Card className="border-border shadow-none">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Брак принят с</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">по</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-sm">Поиск</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Сотрудник, материал, рулон или поставщик"
            />
          </div>
          {(dateFrom || dateTo || search) && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setSearch('');
              }}
            >
              <Icon name="X" size={14} className="mr-1.5" />
              Сбросить фильтры
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Итог по выбранному периоду — главная цифра для разговора с поставщиком. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          Принято брака{dateFrom || dateTo ? ' за период' : ' за 3 месяца'}
          {search && ' (по фильтру)'}
        </span>
        <span className="text-lg font-bold">
          {visible.length} шт. · {formatQty(search ? visibleQty : totalQuantity)} {unit}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка…
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          За выбранный период принятого брака нет
        </p>
      ) : (
        <Card className="shadow-none">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сотрудник</TableHead>
                  <TableHead>Материал</TableHead>
                  <TableHead className="text-right">Кол-во</TableHead>
                  <TableHead>Рулон</TableHead>
                  <TableHead>Поставка</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Принят</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.barcode}>
                    <TableCell>
                      <div className="font-medium">{r.userName}</div>
                      {r.userRole && (
                        <div className="text-xs text-muted-foreground">
                          {roleLabels[r.userRole] || r.userRole}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{r.materialName}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatQty(r.quantity)} {r.unit || ''}
                    </TableCell>
                    <TableCell className="font-mono-tech text-sm">
                      {r.rollBarcode || '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {/* Поставщик известен всегда, номер поставки — только у рулонов,
                          заведённых через приёмку. Показываем что есть. */}
                      <div>{r.supplierName || '—'}</div>
                      {r.shipmentId && (
                        <div className="text-xs text-muted-foreground">
                          поставка №{r.shipmentId}
                          {r.shipmentDate ? ` · ${formatDate(r.shipmentDate)}` : ''}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="secondary">{r.reasonLabel}</Badge>
                      {r.comment && (
                        <div className="mt-1 text-xs text-muted-foreground">{r.comment}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(r.receivedAt)}
                      {r.receivedByName && (
                        <div className="text-xs">{r.receivedByName}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DefectReceivedTab;
