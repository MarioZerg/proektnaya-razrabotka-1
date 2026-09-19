import { useEffect, useState } from 'react';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import type { Employee } from '@/lib/usersApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { Roll } from '@/lib/rollsApi';
import { fetchHangers, type Hanger } from '@/lib/hangersApi';
import {
  fetchEmployeeShifts,
  type EmployeeShiftStatus,
} from '@/lib/shiftSessionsApi';
import CutterActionsCard from '@/components/crm/sewingItems/actions/CutterActionsCard';
import SewerActionsCard from '@/components/crm/sewingItems/actions/SewerActionsCard';
import AdminActionsCard from '@/components/crm/sewingItems/actions/AdminActionsCard';

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
    return (
      <CutterActionsCard
        selectedOrder={selectedOrder}
        orderDetail={orderDetail}
        cutting={cutting}
        canCut={canCut}
        isAlreadyCut={isAlreadyCut}
        matchingRolls={matchingRolls}
        selectedRollId={selectedRollId}
        setSelectedRollId={setSelectedRollId}
        hangers={hangers}
        selectedHanger={selectedHanger}
        setSelectedHanger={setSelectedHanger}
        onCut={onCut}
        onCutGroup={onCutGroup}
      />
    );
  }

  if (isSewerView) {
    return (
      <SewerActionsCard
        selectedOrder={selectedOrder}
        orderDetail={orderDetail}
        cutting={cutting}
        canSendToStickering={canSendToStickering}
        isAlreadyStickering={isAlreadyStickering}
        trimNeeded={trimNeeded}
        matchingRolls={matchingRolls}
        selectedRollId={selectedRollId}
        setSelectedRollId={setSelectedRollId}
        onSendToStickering={onSendToStickering}
        sewWaitSec={sewWaitSec}
      />
    );
  }

  return (
    <AdminActionsCard
      selectedOrder={selectedOrder}
      saving={saving}
      cutting={cutting}
      isAlreadyCut={isAlreadyCut}
      employees={employees}
      workshops={workshops}
      onStatusChange={onStatusChange}
      onAssignUser={onAssignUser}
      onAssignWorkshop={onAssignWorkshop}
      onCut={onCut}
      assignedShift={assignedShift}
      assignedNotOnShift={assignedNotOnShift}
      assignedOtherWorkshop={assignedOtherWorkshop}
    />
  );
};

export default SewingItemActionsSection;
