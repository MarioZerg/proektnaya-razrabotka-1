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
import type { Roll } from '@/lib/rollsApi';
import { fetchHangers, type Hanger } from '@/lib/hangersApi';
import { statusOptions } from '@/components/crm/sewingItems/sewingItemsShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface SewingItemActionsSectionProps {
  selectedOrder: Order;
  orderDetail: OrderDetail | null;
  saving: boolean;
  cutting: boolean;
  employees: Employee[];
  workshops: Workshop[];
  onStatusChange: (status: string) => void;
  onAssignUser: (userId: string) => void;
  onAssignWorkshop: (workshopId: string) => void;
  onCut: (rollId?: number, hangerNumber?: number) => void;
  onCutGroup: (rollId?: number, hangerNumber?: number) => void;
  isCutterView: boolean;
  isSewerView: boolean;
  availableRolls: Roll[];
  onSendToStickering?: (rollId?: number) => void;
  dialogOpen: boolean;
}

const SewingItemActionsSection = ({
  selectedOrder,
  orderDetail,
  saving,
  cutting,
  employees,
  workshops,
  onStatusChange,
  onAssignUser,
  onAssignWorkshop,
  onCut,
  onCutGroup,
  isCutterView,
  isSewerView,
  availableRolls,
  onSendToStickering,
  dialogOpen,
}: SewingItemActionsSectionProps) => {
  const [selectedRollId, setSelectedRollId] = useState<string>('');
  const [hangers, setHangers] = useState<Hanger[]>([]);
  const [selectedHanger, setSelectedHanger] = useState<string>('');

  // Список вешалок нужен только закройщику при раскрое.
  useEffect(() => {
    if (isCutterView && dialogOpen) {
      fetchHangers().then(setHangers).catch(() => setHangers([]));
    }
  }, [isCutterView, dialogOpen]);

  // По умолчанию подставляем последнюю вешалку закройщика (запоминается за ним).
  useEffect(() => {
    if (dialogOpen && orderDetail?.lastHangerNumber != null) {
      setSelectedHanger(String(orderDetail.lastHangerNumber));
    } else if (!dialogOpen) {
      setSelectedHanger('');
    }
  }, [dialogOpen, orderDetail?.lastHangerNumber]);

  // Раскрой доступен ТОЛЬКО пока заказ на раскрое. Раньше блок выбора рулона и вешалки
  // оставался рабочим и на заказах, ушедших дальше по конвейеру («В работе», «Стикеровка»,
  // «Готовые») — закройщик мог случайно списать материал второй раз и сменить вешалку
  // у заказа, который швея уже шьёт.
  const canCut = selectedOrder?.sewingStatus === 'На раскрое';
  const isAlreadyCut = !canCut;
  // Швея отправляет на стикеровку только то, что сейчас в работе (или лежит раскроенным).
  const canSendToStickering =
    selectedOrder?.sewingStatus === 'Раскроено' || selectedOrder?.sewingStatus === 'В работе';
  const isAlreadyStickering = !canSendToStickering;
  // Тесьма нужна только если у товара задан требуемый материал тесьмы. Товары без тесьмы
  // швея отправляет на стикеровку без выбора рулона.
  const trimNeeded = orderDetail?.requiredTrimMaterialId != null;

  if (isCutterView) {
    // Заказ уже ушёл дальше по конвейеру — раскраивать нечего, показываем причину,
    // а не молча заблокированные поля.
    if (!canCut) {
      return (
        <Card className="border-border shadow-none">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Icon name="Info" size={16} />
            Заказ уже в статусе «{selectedOrder?.sewingStatus}» — раскрой завершён, рулон и
            вешалку изменить нельзя.
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Выбор рулона тюля
            {orderDetail?.requiredFabricMaterialName && (
              <span className="ml-1 font-normal text-muted-foreground">
                — нужен материал «{orderDetail.requiredFabricMaterialName}»
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-64 space-y-1.5">
            <Label>Рулон в вашем цехе/смене</Label>
            <Select value={selectedRollId} onValueChange={setSelectedRollId} disabled={cutting || isAlreadyCut}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите рулон" />
              </SelectTrigger>
              <SelectContent>
                {availableRolls.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                ) : (
                  availableRolls.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="w-40 space-y-1.5">
            <Label>Вешалка</Label>
            <Select value={selectedHanger} onValueChange={setSelectedHanger} disabled={cutting || isAlreadyCut}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите вешалку" />
              </SelectTrigger>
              <SelectContent>
                {hangers.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет вешалок</div>
                ) : (
                  hangers.map((h) => (
                    <SelectItem key={h.id} value={String(h.number)}>
                      № {h.number}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() =>
              onCut(
                selectedRollId ? Number(selectedRollId) : undefined,
                selectedHanger ? Number(selectedHanger) : undefined
              )
            }
            disabled={cutting || isAlreadyCut || !selectedRollId}
          >
            {cutting ? (
              <>
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                Списываем материалы...
              </>
            ) : (
              <>
                <Icon name="Scissors" size={16} className="mr-2" />
                Раскроено
              </>
            )}
          </Button>

          {/* Заказ Яндекса из нескольких вещей отправляем в цех ЦЕЛИКОМ одной кнопкой: иначе
              заказ из 30 вещей пришлось бы раскраивать 30 нажатиями, а швея потом собирала бы
              его по кусочкам. Связка вешается вместе — её берёт одна швея. */}
          {selectedOrder.groupSize && selectedOrder.groupSize > 1 && (
            <Button
              variant="outline"
              className="border-violet-500 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
              onClick={() =>
                onCutGroup(
                  selectedRollId ? Number(selectedRollId) : undefined,
                  selectedHanger ? Number(selectedHanger) : undefined
                )
              }
              disabled={cutting || !selectedRollId}
            >
              <Icon name="Package" size={16} className="mr-2" />
              Раскроить всю связку — {selectedOrder.groupSize} вещей
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isSewerView) {
    if (!canSendToStickering) {
      return (
        <Card className="border-border shadow-none">
          <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Icon name="Info" size={16} />
            Заказ уже в статусе «{selectedOrder?.sewingStatus}» — тесьму списывать не нужно.
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Выбор рулона тесьмы
            {orderDetail?.requiredTrimMaterialName && (
              <span className="ml-1 font-normal text-muted-foreground">
                — нужен материал «{orderDetail.requiredTrimMaterialName}»
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          {trimNeeded ? (
            <div className="w-64 space-y-1.5">
              <Label>Рулон тесьмы в вашем цехе/смене</Label>
              <Select
                value={selectedRollId}
                onValueChange={setSelectedRollId}
                disabled={cutting || isAlreadyStickering}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите рулон" />
                </SelectTrigger>
                <SelectContent>
                  {availableRolls.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                  ) : (
                    availableRolls.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Для этого товара тесьма не требуется — можно отправлять на стикеровку.
            </p>
          )}

          <Button
            onClick={() => onSendToStickering?.(selectedRollId ? Number(selectedRollId) : undefined)}
            disabled={cutting || isAlreadyStickering || (trimNeeded && !selectedRollId)}
          >
            {cutting ? (
              <>
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                Списываем тесьму...
              </>
            ) : (
              <>
                <Icon name="Tag" size={16} className="mr-2" />
                Отправить на стикеровку
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Действия</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1.5">
          <Label>Статус пошива</Label>
          <Select value={selectedOrder.sewingStatus} onValueChange={onStatusChange} disabled={saving}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-48 space-y-1.5">
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
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-48 space-y-1.5">
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

        <Button onClick={() => onCut()} disabled={cutting || isAlreadyCut}>
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
      </CardContent>
    </Card>
  );
};

export default SewingItemActionsSection;
