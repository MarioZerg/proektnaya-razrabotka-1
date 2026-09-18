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
import { fetchHangers, hangerLabel, type Hanger } from '@/lib/hangersApi';
import {
  fetchEmployeeShifts,
  type EmployeeShiftStatus,
} from '@/lib/shiftSessionsApi';
import {
  statusOptions,
  formatWait,
  isOrderCancelled,
  employeeLabel,
} from '@/components/crm/sewingItems/sewingItemsShared';
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
  /**
   * Сколько ещё секунд шить ЭТУ вещь. Пока идёт отсчёт, кнопку «Отправить на
   * стикеровку» не нажать: время на пошив задано настройками цеха по ширине изделия.
   * 0 или не передано — можно сдавать.
   */
  sewWaitSec?: number;
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
  sewWaitSec = 0,
}: SewingItemActionsSectionProps) => {
  const [selectedRollId, setSelectedRollId] = useState<string>('');
  const [hangers, setHangers] = useState<Hanger[]>([]);
  const [selectedHanger, setSelectedHanger] = useState<string>('');
  // Кто сейчас реально на смене. Нужно, чтобы предупредить админа: назначенный
  // сотрудник смену не открывал и заказ у себя не увидит.
  const [shifts, setShifts] = useState<EmployeeShiftStatus[]>([]);

  useEffect(() => {
    if (!dialogOpen) return;
    fetchEmployeeShifts().then(setShifts).catch(() => setShifts([]));
  }, [dialogOpen]);

  // НАЗНАЧИЛИ НА ЧЕЛОВЕКА, КОТОРОГО НЕТ НА СМЕНЕ.
  //
  // Швея видит заказы только своего цеха и только пока у неё открыта смена:
  // без смены страница конвейера для неё пуста. Админ же видит заказ в списке
  // и считает, что работа роздана. Так заказ и зависал: у админа он «в работе
  // у Беляевой», а сама Беляева его не видела.
  //
  // Проверяем и цех: сотрудник может быть на смене в другом цехе — тогда заказ
  // этого цеха он тоже не увидит.
  const assignedShift = selectedOrder.assignedUserId
    ? shifts.find((s) => s.id === selectedOrder.assignedUserId)
    : undefined;
  const assignedNotOnShift = Boolean(selectedOrder.assignedUserId) && !assignedShift?.isOpen;
  const assignedOtherWorkshop = Boolean(
    assignedShift?.isOpen &&
      selectedOrder.workshopId &&
      assignedShift.sessionWorkshopId &&
      assignedShift.sessionWorkshopId !== selectedOrder.workshopId
  );

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

  // Выбор рулона сбрасываем при закрытии окна и при переходе к другому заказу.
  //
  // Иначе выбранный для прошлого заказа рулон оставался в поле: тесьма у нового
  // заказа может быть другая, а швея видит уже заполненное поле и жмёт «Отправить»,
  // не перевыбирая. Сервер такой рулон отклонит, но человек не поймёт причины.
  useEffect(() => {
    setSelectedRollId('');
  }, [dialogOpen, selectedOrder?.id]);

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

  // В СПИСКЕ — ТОЛЬКО ТА ТЕСЬМА, КОТОРАЯ УКАЗАНА В КАРТОЧКЕ ТОВАРА.
  //
  // Раньше сюда падали все рулоны тесьмы, что лежат в цехе. Швея выбирала любой,
  // жала «Отправить на стикеровку» и получала отказ уже от сервера: он сверяет
  // рулон с материалом из карточки товара и чужой не принимает. Человек за
  // машинкой не понимал, что не так, и перебирал рулоны наугад.
  //
  // Теперь список сразу совпадает с тем, что проверяет сервер: видно только
  // подходящую тесьму, и ошибиться нечем.
  //
  // У закройщика ровно то же самое, только материал — ткань из карточки товара.
  const requiredMaterialId = isSewerView
    ? orderDetail?.requiredTrimMaterialId
    : orderDetail?.requiredFabricMaterialId;
  const matchingRolls =
    requiredMaterialId != null
      ? availableRolls.filter((r) => r.materialId === requiredMaterialId)
      : availableRolls;

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
        {/* ЗАКАЗ ОТМЕНИЛИ, НО ОН УЖЕ У ЗАКРОЙЩИЦЫ В СТЕКЕ — ДОВОДИМ ДО КОНЦА.
            Раньше здесь стояла заглушка «раскраивать не нужно», и раскрой был
            закрыт: закройщица не могла отправить вещь в «Раскроено» и сбрасывала
            её обратно в «Новый». Там отменённый заказ скрывается из очереди —
            вещь повисала на вешалке, и взять её в работу не мог уже никто.
            Именно так завис заказ 40863907-0422-1.
            Теперь порядок один на все отмены: вещь проходит конвейер целиком и
            на стикеровке получает складской стикер GW вместо ярлыка покупателя. */}
        {isOrderCancelled(selectedOrder) && (
          <CardContent className="space-y-1.5 border-b border-red-200 bg-red-50 py-3">
            <p className="flex items-center gap-2 text-sm font-bold text-red-800">
              <Icon name="XCircle" size={16} className="shrink-0" />
              Покупатель отменил заказ — доводим вещь до конца
            </p>
            <p className="text-sm text-red-900">
              Раскраивайте и передавайте дальше как обычно. На стикеровке вещь
              получит складской стикер и уедет на полку хранения — ярлыка
              покупателя у неё не будет. В «Новый» не возвращайте: оттуда
              отменённый заказ уже никто не сможет взять.
            </p>
          </CardContent>
        )}
        <CardHeader className="pb-3">
          <CardTitle className="break-words text-sm">
            Выбор рулона тюля
            {orderDetail?.requiredFabricMaterialName && (
              <span className="ml-1 font-normal text-muted-foreground">
                — нужен материал «{orderDetail.requiredFabricMaterialName}»
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-64">
            <Label>Рулон в вашем цехе/смене</Label>
            <Select value={selectedRollId} onValueChange={setSelectedRollId} disabled={cutting || isAlreadyCut}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите рулон" />
              </SelectTrigger>
              <SelectContent>
                {matchingRolls.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                ) : (
                  matchingRolls.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {/* Пустой список — тупик: закройщик не понимает, почему нельзя раскроить.
                Называем нужную ткань, чтобы было с чем идти к кладовщику. */}
            {matchingRolls.length === 0 && (
              <p className="text-xs text-amber-700">
                В вашем цехе и смене нет рулонов
                {orderDetail?.requiredFabricMaterialName
                  ? ` «${orderDetail.requiredFabricMaterialName}»`
                  : ' нужной ткани'}
                . Попросите кладовщика передать рулон в цех.
              </p>
            )}
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
                      {hangerLabel(h)}
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
          {/* break-words обязателен: название материала приходит из справочника
              и бывает длинным, а без переноса эта строка задаёт карточке
              минимальную ширину больше экрана телефона и уводит текст вправо. */}
          <CardTitle className="break-words text-sm">
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
            <div className="w-full space-y-1.5 sm:w-64">
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
                  {matchingRolls.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                  ) : (
                    matchingRolls.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                        {/* Материал завела другая смена: расход запишется как работа
                            за чужую смену, чтобы он не приписался её сотрудникам. */}
                        {r.foreignShift ? ' · материал чужой смены' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {/* Пустой список — тупик: швея не понимает, почему нельзя отправить заказ.
                  Называем нужную тесьму, чтобы было с чем идти к кладовщику. */}
              {matchingRolls.length === 0 && (
                <p className="text-xs text-amber-700">
                  В вашем цехе и смене нет рулонов
                  {orderDetail?.requiredTrimMaterialName
                    ? ` «${orderDetail.requiredTrimMaterialName}»`
                    : ' нужной тесьмы'}
                  . Попросите кладовщика передать рулон в цех.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Для этого товара тесьма не требуется — можно отправлять на стикеровку.
            </p>
          )}

          {/* ТАЙМЕР ПОШИВА. Пока он идёт, вещь сдать нельзя: время на неё задано
              настройками цеха по ширине и отсчитывается от взятия заказа. Так место
              в работе освобождается только реально отшитой вещью. Кнопка сама
              показывает остаток и разблокируется — обновлять страницу не нужно. */}
          <Button
            onClick={() => onSendToStickering?.(selectedRollId ? Number(selectedRollId) : undefined)}
            disabled={
              cutting || isAlreadyStickering || (trimNeeded && !selectedRollId) || sewWaitSec > 0
            }
          >
            {cutting ? (
              <>
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                Списываем тесьму...
              </>
            ) : sewWaitSec > 0 ? (
              <>
                <Icon name="Timer" size={16} className="mr-2" />
                Можно сдать через {formatWait(sewWaitSec)}
              </>
            ) : (
              <>
                <Icon name="Tag" size={16} className="mr-2" />
                Отправить на стикеровку
              </>
            )}
          </Button>

          {sewWaitSec > 0 && (
            <p className="text-xs text-muted-foreground">
              Время на пошив этой вещи задано настройками цеха по её ширине. Кнопка
              откроется сама.
            </p>
          )}
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
        <div className="w-full space-y-1.5 sm:w-48">
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

        <div className="w-full space-y-1.5 sm:w-48">
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

        <div className="w-full space-y-1.5 sm:w-48">
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