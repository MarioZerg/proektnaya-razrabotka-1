import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  order: { label: 'Заказ', icon: 'Scissors', className: 'text-sky-600' },
  defect: { label: 'Списание брака', icon: 'TriangleAlert', className: 'text-red-600' },
  return_to_supplier: { label: 'Возврат поставщику', icon: 'Undo2', className: 'text-amber-600' },
  workshop_writeoff: { label: 'Списание в цехе', icon: 'PackageMinus', className: 'text-amber-600' },
};

const stageIcon: Record<string, string> = {
  cutter: 'Scissors',
  sewer: 'Shirt',
  packer: 'Package',
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
            {/* Тип материала и кто отвечает за брак именно по нему: Тюль — закройщик,
                Аксессуары — швея, Упаковка — упаковщик. */}
            <Badge variant="outline">
              {roll.materialType || 'Тип не указан'}
              {roll.defectRoleLabel ? ` · брак: ${roll.defectRoleLabel}` : ''}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {roll.materialName || 'Материал —'}
            {roll.materialType ? ` · ${roll.materialType}` : ''}
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
            <div className="space-y-3">
              {history.map((m, i) => {
                const meta = movementMeta[m.kind] || movementMeta.order;
                return (
                  <div key={i} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        <Icon name={meta.icon} size={16} className={meta.className} />
                        {m.kind === 'order' && m.orderNumber ? `Заказ ${m.orderNumber}` : meta.label}
                        {m.kind === 'defect' && m.defectRoleLabel && (
                          <Badge variant="outline" className="ml-1 capitalize">{m.defectRoleLabel}</Badge>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-sm">
                        <span className="font-semibold text-red-600">-{formatQuantity(m.quantity)} {unit}</span>
                        <span className="text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                      </span>
                    </div>

                    {/* Лесенка этапов заказа: кто раскроил → сшил → упаковал */}
                    {m.kind === 'order' && m.stages && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {m.stages.map((s, si) => (
                          <div key={s.role} className="flex items-center gap-2">
                            <div
                              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                                s.userName ? 'border-border bg-muted/40' : 'border-dashed border-border/60'
                              }`}
                            >
                              <Icon
                                name={stageIcon[s.role] || 'User'}
                                size={15}
                                className={s.userName ? 'text-sky-600' : 'text-muted-foreground'}
                              />
                              <div className="leading-tight">
                                <div className="text-[11px] text-muted-foreground">{s.label}</div>
                                <div className={`text-sm ${s.userName ? 'font-medium' : 'text-muted-foreground'}`}>
                                  {s.userName || '—'}
                                </div>
                                {s.at && (
                                  <div className="text-[10px] text-muted-foreground">{formatDateTime(s.at)}</div>
                                )}
                              </div>
                            </div>
                            {si < m.stages!.length - 1 && (
                              <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Брак / прочие списания: кто зафиксировал и комментарий */}
                    {m.kind !== 'order' && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        {m.userName ? <span>Зафиксировал: <span className="text-foreground">{m.userName}</span></span> : null}
                        {m.comment ? <span className="ml-2">· {m.comment}</span> : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default RollShow;