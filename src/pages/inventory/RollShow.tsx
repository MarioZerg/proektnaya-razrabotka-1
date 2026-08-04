import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { fetchRollDetail, type RollDetail, type RollMovement, type RollStatus } from '@/lib/rollsApi';
import { formatDateTime } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';

const statusLabels: Record<RollStatus, { label: string; variant: 'secondary' | 'default' | 'outline' }> = {
  in_storage: { label: 'На складе', variant: 'secondary' },
  in_workshop: { label: 'В цехе', variant: 'default' },
  completed: { label: 'Завершён', variant: 'outline' },
};

const movementMeta: Record<RollMovement['kind'], { label: string; icon: string; className: string }> = {
  order: { label: 'Раскрой / пошив заказа', icon: 'Scissors', className: 'text-sky-600' },
  defect: { label: 'Списание брака', icon: 'TriangleAlert', className: 'text-red-600' },
  return_to_supplier: { label: 'Возврат поставщику', icon: 'Undo2', className: 'text-amber-600' },
  workshop_writeoff: { label: 'Списание в цехе', icon: 'PackageMinus', className: 'text-amber-600' },
};

const RollShow = () => {
  const { id } = useParams();
  const rollId = Number(id);
  const navigate = useNavigate();
  const [data, setData] = useState<RollDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchRollDetail(rollId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить рулон'))
      .finally(() => setLoading(false));
  }, [rollId]);

  if (loading) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  if (error || !data) {
    return (
      <CrmLayout>
        <p className="text-sm text-destructive">{error || 'Рулон не найден'}</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/crm/inventory/rolls')}>
          <Icon name="ChevronLeft" size={16} className="mr-1" />К рулонам
        </Button>
      </CrmLayout>
    );
  }

  const { roll, history } = data;
  const usedQty = Math.max(0, roll.initialQuantity - roll.remainingQuantity);
  const usedPct = roll.initialQuantity > 0 ? Math.min(100, (usedQty / roll.initialQuantity) * 100) : 0;
  const remainPct = 100 - usedPct;
  const unit = roll.unit || '';

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/crm/inventory/rolls')}
            className="mb-2 -ml-2"
          >
            <Icon name="ChevronLeft" size={16} className="mr-1" />К рулонам
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold">Рулон #{roll.id}</h1>
            <span className="font-mono-tech text-sm text-muted-foreground">{roll.barcode}</span>
            <Badge variant={statusLabels[roll.status].variant}>{statusLabels[roll.status].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {roll.materialName || 'Материал —'}
            {roll.workshopName ? ` · ${roll.workshopName}` : ''}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border shadow-none md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Остаток материала</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-bold">
                    {formatQuantity(roll.remainingQuantity)} <span className="text-lg font-normal text-muted-foreground">{unit}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    из {formatQuantity(roll.initialQuantity)} {unit} · осталось {Math.round(remainPct)}%
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  Израсходовано<br />
                  <span className="font-medium text-foreground">{formatQuantity(usedQty)} {unit}</span>
                </div>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${remainPct <= 15 ? 'bg-red-500' : remainPct <= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${remainPct}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Данные рулона</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Смена</span>
                <span className="font-medium">{roll.shiftNumber ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Создан</span>
                <span className="font-medium">{formatDateTime(roll.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Завершён</span>
                <span className="font-medium">{roll.completedAt ? formatDateTime(roll.completedAt) : '—'}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-2">
          <h2 className="font-semibold">История использования ({history.length})</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Из этого рулона ещё не списывали материал</p>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Операция</TableHead>
                    <TableHead className="text-primary-foreground">Кто</TableHead>
                    <TableHead className="text-primary-foreground">Заказ / комментарий</TableHead>
                    <TableHead className="text-primary-foreground text-right">Списано</TableHead>
                    <TableHead className="text-primary-foreground">Когда</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((m, i) => {
                    const meta = movementMeta[m.kind] || movementMeta.order;
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <span className="flex items-center gap-1.5">
                            <Icon name={meta.icon} size={15} className={meta.className} />
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell>{m.userName || '—'}</TableCell>
                        <TableCell>
                          {m.orderNumber ? (
                            <span className="font-medium">Заказ {m.orderNumber}</span>
                          ) : (
                            m.comment || '—'
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          -{formatQuantity(m.quantity)} {unit}
                        </TableCell>
                        <TableCell>{formatDateTime(m.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default RollShow;
