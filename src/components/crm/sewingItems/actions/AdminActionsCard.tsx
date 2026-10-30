import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import type { Employee } from '@/lib/usersApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';
import type { Roll } from '@/lib/rollsApi';
import { statusOptions, employeeLabel } from '@/components/crm/sewingItems/sewingItemsShared';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { formatQuantity } from '@/lib/formatQuantity';
import SewerAccrualPreviewBox from '@/components/crm/sewingItems/actions/SewerAccrualPreviewBox';

interface AdminActionsCardProps {
  selectedOrder: Order;
  orderDetail: OrderDetail | null;
  saving: boolean;
  cutting: boolean;
  isAlreadyCut: boolean;
  employees: Employee[];
  workshops: Workshop[];
  fabricRolls: Roll[];
  trimRolls: Roll[];
  onStatusChange: (
    status: string,
    rolls?: { fabricRollId?: number; trimRollId?: number; sewerUserId?: number },
  ) => void;
  onAssignUser: (userId: string) => void;
  onAssignWorkshop: (workshopId: string) => void;
  onCut: (rollId?: number, hangerNumber?: number) => void;
  assignedShift?: EmployeeShiftStatus;
  assignedNotOnShift: boolean;
  assignedOtherWorkshop: boolean;
  shiftsError?: string | null;
  onRetryShifts?: () => void;
}

/** Блок администратора: статус пошива, назначение сотрудника и цеха, ручной раскрой. */
const AdminActionsCard = ({
  selectedOrder,
  orderDetail,
  saving,
  cutting,
  isAlreadyCut,
  employees,
  workshops,
  fabricRolls,
  trimRolls,
  onStatusChange,
  onAssignUser,
  onAssignWorkshop,
  onCut,
  assignedShift,
  assignedNotOnShift,
  assignedOtherWorkshop,
  shiftsError,
  onRetryShifts,
}: AdminActionsCardProps) => {
  const [fabricRollId, setFabricRollId] = useState('');
  const [trimRollId, setTrimRollId] = useState('');
  const selectedFabric = fabricRolls.find((r) => String(r.id) === fabricRollId);
  const selectedTrim = trimRolls.find((r) => String(r.id) === trimRollId);

  // СТАТУС НЕ МЕНЯЕМ СРАЗУ ПО ВЫБОРУ В СПИСКЕ.
  // Админ выбирает новый статус, указывает, кто шил, и рулон тесьмы, видит
  // будущее начисление — и только потом жмёт «Перевести». Раньше статус
  // применялся сразу, а швеёй записывался сам админ: деньги за пошив уходили не тому.
  const [targetStatus, setTargetStatus] = useState(selectedOrder.sewingStatus);
  const defaultSewer = selectedOrder.sewerUserId || selectedOrder.assignedUserId;
  const [sewerId, setSewerId] = useState(defaultSewer ? String(defaultSewer) : '');
  // Статус применился или открыли другой заказ — форма возвращается к текущему.
  useEffect(() => {
    setTargetStatus(selectedOrder.sewingStatus);
    const d = selectedOrder.sewerUserId || selectedOrder.assignedUserId;
    setSewerId(d ? String(d) : '');
  }, [selectedOrder.id, selectedOrder.sewingStatus, selectedOrder.sewerUserId, selectedOrder.assignedUserId]);
  const statusChanged = targetStatus !== selectedOrder.sewingStatus;
  const targetIdx = statusOptions.indexOf(targetStatus as (typeof statusOptions)[number]);
  const needsSewer = targetIdx >= statusOptions.indexOf('Стикеровка');
  const needsTrim = needsSewer && Boolean(orderDetail?.requiredTrimMaterialId);
  const sewer = employees.find((e) => String(e.id) === sewerId);
  // Тесьма уже списана на заказ (например, швеёй) — второй раз не просим.
  const trimAlready = Boolean(
    orderDetail?.materialUsage?.some((u) => u.materialId === orderDetail.requiredTrimMaterialId),
  );

  const applyStatus = () => {
    onStatusChange(targetStatus, {
      fabricRollId: fabricRollId ? Number(fabricRollId) : undefined,
      trimRollId: trimRollId ? Number(trimRollId) : undefined,
      sewerUserId: needsSewer && sewerId ? Number(sewerId) : undefined,
    });
  };

  return (
  <Card className="border-border shadow-none">
    <CardHeader className="pb-3">
      <CardTitle className="text-sm">Действия</CardTitle>
    </CardHeader>
    <CardContent className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="min-w-0 space-y-1.5">
        <Label>Статус пошива</Label>
        <Select value={targetStatus} onValueChange={setTargetStatus} disabled={saving}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
                {s === selectedOrder.sewingStatus ? ' · сейчас' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {statusChanged
            ? `Сейчас: «${selectedOrder.sewingStatus}». Проверьте данные ниже и нажмите «Перевести».`
            : 'Выберите новый статус — появятся поля для перевода.'}
        </p>
      </div>

      {statusChanged && needsSewer && (
        <div className="min-w-0 space-y-1.5">
          <Label>Кто шил</Label>
          <Select value={sewerId} onValueChange={setSewerId} disabled={saving}>
            <SelectTrigger className="h-auto min-h-10 py-1.5 text-left [&>span]:line-clamp-none [&>span]:whitespace-normal">
              <SelectValue placeholder="Выберите сотрудника" />
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-1rem)]">
              {employees.map((e) => (
                <SelectItem key={e.id} value={String(e.id)} className="whitespace-normal break-words">
                  {employeeLabel(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Ему пойдёт начисление за пошив, когда заказ станет «Готовые».
          </p>
        </div>
      )}

      <div className="min-w-0 space-y-1.5">
        <Label>
          Рулон ткани
          {orderDetail?.requiredFabricMaterialName
            ? ` — «${orderDetail.requiredFabricMaterialName}»`
            : ''}
        </Label>
        <Select value={fabricRollId} onValueChange={setFabricRollId} disabled={saving}>
          <SelectTrigger className="h-auto min-h-10 py-1.5 text-left [&>span]:line-clamp-none [&>span]:whitespace-normal">
            <SelectValue placeholder="С какого рулона кроить">
              {selectedFabric ? (
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">
                    #{selectedFabric.barcode} — {formatQuantity(selectedFabric.remainingQuantity)}{' '}
                    {selectedFabric.unit}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {selectedFabric.materialName}
                  </span>
                </span>
              ) : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-1rem)]">
            {fabricRolls.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет рулонов ткани в цехе</div>
            ) : (
              fabricRolls.map((r) => (
                <SelectItem key={r.id} value={String(r.id)} className="whitespace-normal break-words">
                  <span className="font-semibold">#{r.barcode}</span> — {formatQuantity(r.remainingQuantity)} {r.unit}
                  <span className="block text-xs text-muted-foreground">{r.materialName}</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Нужен при переводе в «Раскроено» и дальше. Тесьму здесь не списываем.
        </p>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label>
          Рулон тесьмы
          {orderDetail?.requiredTrimMaterialName
            ? ` — «${orderDetail.requiredTrimMaterialName}»`
            : ''}
        </Label>
        <Select
          value={trimRollId}
          onValueChange={setTrimRollId}
          disabled={saving || !orderDetail?.requiredTrimMaterialId}
        >
          <SelectTrigger className="h-auto min-h-10 py-1.5 text-left [&>span]:line-clamp-none [&>span]:whitespace-normal">
            <SelectValue placeholder="Нужен на стикеровке">
              {selectedTrim ? (
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">
                    #{selectedTrim.barcode} — {formatQuantity(selectedTrim.remainingQuantity)}{' '}
                    {selectedTrim.unit}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {selectedTrim.materialName}
                  </span>
                </span>
              ) : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-w-[calc(100vw-1rem)]">
            {trimRolls.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет рулонов тесьмы в цехе</div>
            ) : (
              trimRolls.map((r) => (
                <SelectItem key={r.id} value={String(r.id)} className="whitespace-normal break-words">
                  <span className="font-semibold">#{r.barcode}</span> — {formatQuantity(r.remainingQuantity)} {r.unit}
                  <span className="block text-xs text-muted-foreground">{r.materialName}</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {needsTrim && statusChanged
            ? 'Укажите, с какого рулона списать тесьму на этот заказ.'
            : 'Только когда переводите на стикеровку или в «Готовые». На «Раскроено» тесьмы ещё нет.'}
        </p>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label>Сотрудник</Label>
        <Select
          value={selectedOrder.assignedUserId ? String(selectedOrder.assignedUserId) : 'none'}
          onValueChange={onAssignUser}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue placeholder="Не назначен" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Не назначен</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={String(e.id)}>
                {/* ПОЛНЫХ ТЁЗОК В СПИСКЕ РАЗЛИЧАТЬ НЕЧЕМ.
                    В цехе работают два человека с почти одинаковым именем
                    («Беляева Наталия» и «Беляева Наталия Николаевна»), и админ
                    назначал заказ не на того: в списке они выглядели одинаково.
                    Заказ уходил на карточку, под которой человек не работает, —
                    у самой швеи он не появлялся. Показываем рядом смену, цех и
                    последние цифры телефона: этого хватает, чтобы не промахнуться. */}
                {employeeLabel(e)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Назначить мало — человек должен увидеть заказ у себя. Пока смена
            не открыта, конвейер у него пуст, и работа стоит. */}
        {shiftsError && (
          <WarehouseFetchError
            title="Не удалось проверить смены"
            description={shiftsError}
            onRetry={onRetryShifts || (() => {})}
          />
        )}
        {assignedNotOnShift && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
            <span>
              Смена не открыта — сотрудник не увидит этот заказ у себя. Он появится
              у него, как только смена будет открыта.
            </span>
          </p>
        )}
        {assignedOtherWorkshop && (
          <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
            <span>
              Сотрудник на смене в другом цехе
              {assignedShift?.sessionWorkshopName
                ? ` (${assignedShift.sessionWorkshopName})`
                : ''}{' '}
              — заказ этого цеха он не увидит.
            </span>
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label>Цех</Label>
        <Select
          value={selectedOrder.workshopId ? String(selectedOrder.workshopId) : 'none'}
          onValueChange={onAssignWorkshop}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue placeholder="Не назначен" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Не назначен</SelectItem>
            {workshops.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label aria-hidden className="invisible hidden sm:block">{'\u00A0'}</Label>
      <Button className="w-full" onClick={() => onCut()} disabled={cutting || isAlreadyCut}>
        {cutting ? (
          <>
            <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            Списываем материалы...
          </>
        ) : (
          <>
            <Icon name="Scissors" size={16} className="mr-2" />
            Раскроить
          </>
        )}
      </Button>
      </div>

      {statusChanged && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 sm:col-span-2 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Перевод:</span>
            <b>{selectedOrder.sewingStatus}</b>
            <Icon name="ArrowRight" size={14} className="text-muted-foreground" />
            <b>{targetStatus}</b>
          </div>
          {needsSewer && (
            <SewerAccrualPreviewBox
              orderId={selectedOrder.id}
              sewerId={sewerId ? Number(sewerId) : null}
              sewerName={sewer?.fullName}
              immediate={targetStatus === 'Готовые'}
            />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setTargetStatus(selectedOrder.sewingStatus)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={applyStatus}
              disabled={saving || (needsSewer && !sewerId) || (needsTrim && !trimRollId && !trimAlready)}
            >
              <Icon name={saving ? 'Loader2' : 'Check'} size={16} className={saving ? 'mr-2 animate-spin' : 'mr-2'} />
              Перевести в «{targetStatus}»
            </Button>
          </div>
        </div>
      )}
    </CardContent>
  </Card>
  );
};

export default AdminActionsCard;
