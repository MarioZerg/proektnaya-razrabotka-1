import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchShipmentDetail,
  updateRollQuantity,
  updateShipmentLogistics,
  type ShipmentDetail,
  type ShipmentItem,
} from '@/lib/shipmentsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { formatQuantity } from '@/lib/formatQuantity';
import { formatDateTime } from '@/lib/dateUtils';

/**
 * Карточка приёмки от поставщика.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СТРАНИЦА. В списке приёмок рулоны раскрывались мелкой гармошкой:
 * на 284 позиции это нечитаемо, а кладовщику нужно спокойно найти нужный рулон и
 * перепечатать на него стикер — наклейки на складе рвутся и затираются.
 *
 * ПРАВА. Кладовщик здесь только смотрит и печатает: принятую приёмку он не меняет —
 * материал уже на складе, и цифры за ним закреплены. Администратор дополнительно
 * может поправить метраж целого рулона (бирки поставщика врут) и дозаполнить
 * логистику, если счёт за перевозку пришёл позже машины.
 */
const SupplyShow = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canView = isAdmin || isStorekeeperRole(user?.role);

  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Правка метража: держим только одну открытую строку — так меньше шансов
  // случайно переписать соседний рулон.
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingQty, setSavingQty] = useState(false);

  const [logisticsValue, setLogisticsValue] = useState('');
  const [savingLogistics, setSavingLogistics] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetchShipmentDetail(Number(id))
      .then(setDetail)
      .catch((e) =>
        toast({
          title: 'Не удалось открыть приёмку',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** Наклейка рулона: материал с метражом, поставщик и дата приёмки. */
  const printItem = (item: ShipmentItem) => {
    const code = item.barcode || item.reservedBarcodes?.[0];
    if (!code) {
      toast({ title: 'У этой позиции ещё нет штрихкода', variant: 'destructive' });
      return;
    }
    printBarcodes(
      [
        {
          code,
          label: `${item.materialName} — ${formatQuantity(item.quantity)} ${item.unit || ''}`,
          supplier: item.supplierName || detail?.supplierName,
          receivedAt: detail?.completedAt || detail?.createdAt,
        },
      ],
      `Стикер рулона ${code}`,
    );
  };

  /** Печать всех найденных стикеров разом — когда переклеивают целую партию. */
  const printAllFound = () => {
    const items = filtered
      .map((i) => ({ item: i, code: i.barcode || i.reservedBarcodes?.[0] }))
      .filter((x) => x.code);
    if (items.length === 0) {
      toast({ title: 'Печатать нечего', variant: 'destructive' });
      return;
    }
    printBarcodes(
      items.map(({ item, code }) => ({
        code: code as string,
        label: `${item.materialName} — ${formatQuantity(item.quantity)} ${item.unit || ''}`,
        supplier: item.supplierName || detail?.supplierName,
        receivedAt: detail?.completedAt || detail?.createdAt,
      })),
      `Приёмка #${id}`,
    );
  };

  const saveQuantity = async (item: ShipmentItem) => {
    const value = Number((editValue || '').replace(',', '.'));
    if (!value || value <= 0) {
      toast({ title: 'Укажите метраж больше нуля', variant: 'destructive' });
      return;
    }
    setSavingQty(true);
    try {
      await updateRollQuantity(item.id, value);
      toast({
        title: 'Метраж изменён',
        description: 'Себестоимость метра пересчитана по всей приёмке',
      });
      setEditItemId(null);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось изменить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingQty(false);
    }
  };

  const saveLogistics = async () => {
    const value = Number((logisticsValue || '').replace(',', '.'));
    if (!value || value <= 0) {
      toast({ title: 'Укажите стоимость больше нуля', variant: 'destructive' });
      return;
    }
    setSavingLogistics(true);
    try {
      await updateShipmentLogistics(Number(id), value);
      toast({
        title: 'Логистика указана',
        description: 'Себестоимость метра пересчитана по всей приёмке',
      });
      setLogisticsValue('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingLogistics(false);
    }
  };

  // Поиск по штрихкоду и материалу: на 284 позициях глазами рулон не найти, а
  // кладовщик приходит с конкретным рулоном в руках.
  const filtered = useMemo(() => {
    const items = detail?.items || [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.barcode || '').toLowerCase().includes(q) ||
        (i.reservedBarcodes || []).some((c) => c.toLowerCase().includes(q)) ||
        (i.materialName || '').toLowerCase().includes(q),
    );
  }, [detail, search]);

  const totals = useMemo(() => {
    const items = detail?.items || [];
    const inStorage = items.filter((i) => i.rollStatus === 'in_storage').length;
    const quantity = items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
    return { count: items.length, inStorage, quantity };
  }, [detail]);

  if (!canView) {
    return (
      <CrmLayout>
        <p className="text-muted-foreground">Раздел доступен кладовщикам и администратору</p>
      </CrmLayout>
    );
  }

  const isPending = detail?.status === 'Новый';

  return (
    <CrmLayout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button variant="ghost" size="sm" className="mb-1 px-0" onClick={() => navigate(-1)}>
              <Icon name="ChevronLeft" size={16} className="mr-1" />
              К приёмкам
            </Button>
            <h1 className="text-xl font-bold">Приёмка #{id}</h1>
            {detail && (
              <p className="mt-1 text-sm text-muted-foreground">
                {detail.itemSuppliers || detail.supplierName || 'Поставщик не указан'} ·{' '}
                {formatDateTime(detail.completedAt || detail.createdAt)}
                {detail.comment ? ` · ${detail.comment}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={printAllFound} disabled={loading}>
              <Icon name="Barcode" size={16} className="mr-1" />
              Печать всех ({filtered.length})
            </Button>
          </div>
        </div>

        {loading && <p className="text-muted-foreground">Загрузка...</p>}

        {detail && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Card className="shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-muted-foreground">Статус</p>
                  <Badge variant={isPending ? 'secondary' : 'default'} className="mt-1">
                    {isPending ? 'Ожидает подтверждения' : detail.status}
                  </Badge>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-muted-foreground">Рулонов</p>
                  <p className="text-2xl font-bold">{totals.count}</p>
                  <p className="text-xs text-muted-foreground">на складе: {totals.inStorage}</p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-muted-foreground">Всего метров/шт</p>
                  <p className="text-2xl font-bold">{formatQuantity(totals.quantity)}</p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-muted-foreground">Логистика</p>
                  <p className="text-2xl font-bold">
                    {detail.logisticsCost ? `${detail.logisticsCost.toLocaleString('ru-RU')} ₽` : '—'}
                  </p>
                  {!detail.logisticsCost && (
                    <p className="text-xs text-amber-700">не указана</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Счёт за перевозку часто приходит позже машины. Дозаполнить сумму можно
                только пока её нет: по проставленной логистике уже считались недостачи. */}
            {isAdmin && !detail.logisticsCost && !isPending && (
              <Card className="border-amber-300 bg-amber-50 shadow-none">
                <CardContent className="flex flex-wrap items-end gap-3 py-4">
                  <div className="space-y-1.5">
                    <Label className="text-amber-900">Логистика за поставку, ₽</Label>
                    <Input
                      inputMode="decimal"
                      placeholder="25450"
                      className="w-40 bg-white"
                      value={logisticsValue}
                      onChange={(e) => setLogisticsValue(e.target.value)}
                    />
                  </div>
                  <Button onClick={saveLogistics} disabled={savingLogistics}>
                    {savingLogistics ? 'Сохранение...' : 'Указать логистику'}
                  </Button>
                  <p className="text-xs text-amber-800">
                    Разделится поровну на все метры приёмки и войдёт в себестоимость.
                    Указать можно один раз
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Прямая инструкция администратору: без неё правку метража не находили —
                искали отдельную кнопку «Редактировать», которой тут нет и не будет. */}
            {isAdmin && !isPending && totals.inStorage > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
                <Icon name="Pencil" size={16} className="mt-0.5 shrink-0 text-primary" />
                <p className="text-sm">
                  <span className="font-medium">Метраж рулона правится прямо в таблице:</span>{' '}
                  нажмите на число в столбце «Метраж» — оно обведено пунктиром у тех рулонов,
                  которые ещё целыми лежат на складе. Рулоны в цехе и початые изменить нельзя
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Icon
                  name="Search"
                  size={15}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  className="pl-8"
                  placeholder="Штрихкод или материал — можно сканером"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {search && (
                <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                  Сбросить
                </Button>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Материал</TableHead>
                    <TableHead>Штрихкод</TableHead>
                    <TableHead className="text-right">
                      Метраж
                      {isAdmin && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (можно менять)
                        </span>
                      )}
                    </TableHead>
                    <TableHead>Где рулон</TableHead>
                    <TableHead>Поставщик</TableHead>
                    <TableHead className="text-right">Себестоимость</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        Ничего не найдено
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((item) => {
                    const code = item.barcode || item.reservedBarcodes?.[0];
                    const editing = editItemId === item.id;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.materialName}</TableCell>
                        <TableCell className="font-mono-tech text-sm">{code || '—'}</TableCell>
                        <TableCell className="text-right">
                          {editing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                autoFocus
                                inputMode="decimal"
                                className="h-8 w-24 text-right"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                              />
                              <Button
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => saveQuantity(item)}
                                disabled={savingQty}
                              >
                                <Icon name="Check" size={14} />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditItemId(null)}
                              >
                                <Icon name="X" size={14} />
                              </Button>
                            </div>
                          ) : isAdmin && item.canEditQuantity ? (
                            /* КЛИКАБЕЛЬНЫЙ МЕТРАЖ. Раньше правка висела серым карандашом
                               в дальней колонке справа — администратор её просто не находил.
                               Теперь нажимается само число: рядом с ним стоит карандаш,
                               и подпись прямо говорит, что цифру можно менять. */
                            <button
                              type="button"
                              className="ml-auto flex items-center gap-1.5 rounded-md border border-dashed
                                         border-primary/40 px-2 py-1 text-right font-medium
                                         hover:border-primary hover:bg-primary/5"
                              title="Нажмите, чтобы изменить метраж рулона"
                              onClick={() => {
                                setEditItemId(item.id);
                                setEditValue(String(item.quantity ?? ''));
                              }}
                            >
                              <Icon name="Pencil" size={12} className="text-primary" />
                              {formatQuantity(item.quantity)} {item.unit}
                            </button>
                          ) : (
                            <span className="font-medium">
                              {formatQuantity(item.quantity)} {item.unit}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.rollStatus === 'in_storage' && (
                            <Badge variant="secondary">На складе</Badge>
                          )}
                          {item.rollStatus === 'in_workshop' && (
                            <Badge variant="default">В цехе</Badge>
                          )}
                          {item.rollStatus === 'completed' && (
                            <Badge variant="outline">Израсходован</Badge>
                          )}
                          {!item.rollStatus && (
                            <span className="text-xs text-muted-foreground">не принят</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.supplierName || detail.supplierName || '—'}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {item.costPerUnit != null
                            ? `${item.costPerUnit.toFixed(2)} ₽`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              title="Печать стикера рулона (120×75 мм)"
                              onClick={() => printItem(item)}
                            >
                              <Icon name="Barcode" size={14} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              Принятую приёмку изменить нельзя — материал уже на складе.
              {isAdmin
                ? ' Администратор может поправить метраж рулона, пока тот целым лежит на складе.'
                : ' Если метраж на бирке не совпал с фактом, скажите администратору.'}
            </p>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default SupplyShow;
