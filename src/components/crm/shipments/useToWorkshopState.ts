import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  fetchShipments,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { getAccessZone } from '@/lib/roles';

export type TabValue = 'new' | 'completed';

// Вкладки: "Новые" — заявки в процессе (Новый/Отправлено), "Завершённые" — уже
// закрытые (Получено/Выполнена — старые тестовые записи). Страница всегда
// открывается на вкладке "Новые".
const isCompletedStatus = (status: string) => status === 'Получено' || status === 'Выполнена';

/**
 * Всё состояние страницы "Отгрузка в цех": загрузка справочников и заявок,
 * фильтры, вкладки, производные списки. Логика перенесена 1:1 из ToWorkshop.tsx.
 */
export const useToWorkshopState = () => {
  const { user } = useAuth();
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  const zone = getAccessZone(user?.role);
  // Админ тоже может оформить заявку кладовщику — но за конкретный цех и смену, которые
  // он выбирает руками (своего цеха у него нет). Заявка уходит с его именем и пометкой.
  const isAdmin = user?.role === 'admin';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>('new');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [workshopFilter, setWorkshopFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reqComment, setReqComment] = useState('');
  const [reqMaterialId, setReqMaterialId] = useState('');
  // Только для админского режима: цех и смена, за которые оформляется заявка.
  const [reqWorkshopId, setReqWorkshopId] = useState('');
  const [reqShiftNumber, setReqShiftNumber] = useState('');

  const [activeShipment, setActiveShipment] = useState<ShipmentDetail | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [expandedRolls, setExpandedRolls] = useState<Record<number, ShipmentDetail | null>>({});
  const [loadingRolls, setLoadingRolls] = useState<number | null>(null);

  const [receiveShipment, setReceiveShipment] = useState<ShipmentDetail | null>(null);
  const [receiving, setReceiving] = useState(false);

  const load = () => {
    setLoading(true);
    // Справочники запрашиваем каждый сам по себе: если связь моргнула и один не дошёл,
    // список заявок всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchWorkshops().then(setWorkshops).catch(() => {});
    fetchMaterialsData()
      .then((materialsData) => setMaterials(materialsData.materials))
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchShipments('to_workshop')
      .then(setShipments)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (activeShipment) scanInputRef.current?.focus();
  }, [activeShipment]);

  // При смене цеха в фильтре сбрасываем выбранную смену — иначе можно было бы оставить
  // смену от предыдущего цеха, невалидную для нового.
  useEffect(() => {
    setShiftFilter('all');
  }, [workshopFilter]);

  // Цех/смена ТЕКУЩЕЙ открытой рабочей смены (может отличаться от штатных в гостевом
  // режиме) — сотрудник в гостях запрашивает и видит заявки именно той смены, куда зашёл.
  const effectiveWorkshopId = user?.activeWorkshopId ?? user?.workshopId ?? null;
  const effectiveShiftNumber = user?.activeShiftNumber ?? user?.shiftNumber ?? null;

  // Швея/закройщик/упаковщик видит только заявки СВОЕГО цеха и смены — не весь список.
  // Заявка без указанной смены (shiftNumber === null) относится ко всем сменам этого цеха.
  // Кладовщик и админ видят полный список, как и раньше.
  const shiftFilteredShipments = isProduction
    ? shipments.filter(
        (s) =>
          s.workshopId === effectiveWorkshopId &&
          (s.shiftNumber === null || s.shiftNumber === effectiveShiftNumber)
      )
    : shipments;

  const tabFilteredShipments = shiftFilteredShipments.filter((s) =>
    activeTab === 'new' ? !isCompletedStatus(s.status) : isCompletedStatus(s.status)
  );

  // Материалы в фильтре — только те, что разрешены цеху (workshops.allowedMaterials).
  // Иначе закройщик Цеха №1 видел бы в списке «Вуаль без утяжелителя» — ткань, которая
  // относится к другому цеху и в его заявках никогда не встретится.
  // Кладовщик и админ работают со всеми цехами, поэтому у них список полный.
  const filterWorkshopId = isProduction
    ? effectiveWorkshopId
    : workshopFilter !== 'all'
      ? Number(workshopFilter)
      : null;
  const allowedMaterialIds = filterWorkshopId
    ? workshops.find((w) => w.id === filterWorkshopId)?.allowedMaterials || []
    : null;
  const filterMaterials = allowedMaterialIds
    ? materials.filter((m) => allowedMaterialIds.includes(m.id))
    : materials;

  // Цех сменили, а выбранный материал в новом цехе не используется — сбрасываем фильтр,
  // иначе список молча оказался бы пустым.
  useEffect(() => {
    if (materialFilter === 'all') return;
    if (!filterMaterials.some((m) => String(m.id) === materialFilter)) {
      setMaterialFilter('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterWorkshopId, materials.length, workshops.length]);

  const visibleShipments = tabFilteredShipments.filter((s) => {
    if (materialFilter !== 'all' && String(s.materialId) !== materialFilter) return false;
    if (workshopFilter !== 'all' && String(s.workshopId) !== workshopFilter) return false;
    if (shiftFilter !== 'all' && String(s.shiftNumber) !== shiftFilter) return false;
    return true;
  });

  // Список смен для выбора в фильтре — зависит от выбранного цеха (у каждого цеха своё
  // число смен и свои названия смен), при "Все цеха" берём максимум смен среди всех цехов.
  const shiftOptions =
    workshopFilter === 'all'
      ? Array.from({ length: Math.max(0, ...workshops.map((w) => w.shiftsCount)) }, (_, i) => i + 1)
      : Array.from(
          { length: workshops.find((w) => String(w.id) === workshopFilter)?.shiftsCount || 0 },
          (_, i) => i + 1
        );

  const shiftOptionLabel = (shiftNumber: number) => {
    if (workshopFilter !== 'all') {
      const w = workshops.find((wk) => String(wk.id) === workshopFilter);
      return w?.shiftNames?.[shiftNumber - 1] || `Смена № ${shiftNumber}`;
    }
    return `Смена № ${shiftNumber}`;
  };

  const newCount = shiftFilteredShipments.filter((s) => !isCompletedStatus(s.status)).length;
  const completedCount = shiftFilteredShipments.filter((s) => isCompletedStatus(s.status)).length;

  const activeFiltersCount = useMemo(
    () =>
      [materialFilter !== 'all', workshopFilter !== 'all', shiftFilter !== 'all'].filter(Boolean)
        .length,
    [materialFilter, workshopFilter, shiftFilter]
  );

  const resetFilters = () => {
    setMaterialFilter('all');
    setWorkshopFilter('all');
    setShiftFilter('all');
  };

  const openCreate = () => {
    setReqComment('');
    setReqMaterialId('');
    setReqWorkshopId('');
    setReqShiftNumber('');
    setCreateOpen(true);
  };

  // Материалы в диалоге: у сотрудника — всё, что пришло с сервера, у админа — только
  // разрешённые выбранному цеху, иначе он закажет ткань, которую этот цех не шьёт.
  const dialogWorkshopAllowed = isAdmin
    ? workshops.find((w) => String(w.id) === reqWorkshopId)?.allowedMaterials || null
    : null;
  const dialogMaterials = dialogWorkshopAllowed
    ? materials.filter((m) => dialogWorkshopAllowed.includes(m.id))
    : materials;

  // Цех и смена в заявке: у сотрудника из открытой смены, у админа — выбранные в диалоге.
  const requestWorkshopId = isAdmin ? Number(reqWorkshopId) || null : effectiveWorkshopId;
  const requestShiftNumber = isAdmin ? Number(reqShiftNumber) || null : effectiveShiftNumber;

  // Сменили цех — выбранные смена и материал могли остаться от прошлого цеха.
  useEffect(() => {
    setReqShiftNumber('');
    setReqMaterialId('');
  }, [reqWorkshopId]);

  return {
    user,
    isProduction,
    isAdmin,
    zone,
    shipments,
    workshops,
    materials,
    loading,
    activeTab,
    setActiveTab,
    materialFilter,
    setMaterialFilter,
    workshopFilter,
    setWorkshopFilter,
    shiftFilter,
    setShiftFilter,
    deleteId,
    setDeleteId,
    deleting,
    setDeleting,
    createOpen,
    setCreateOpen,
    creating,
    setCreating,
    reqComment,
    setReqComment,
    reqMaterialId,
    setReqMaterialId,
    reqWorkshopId,
    setReqWorkshopId,
    reqShiftNumber,
    setReqShiftNumber,
    activeShipment,
    setActiveShipment,
    scanCode,
    setScanCode,
    scanning,
    setScanning,
    scanInputRef,
    expandedRolls,
    setExpandedRolls,
    loadingRolls,
    setLoadingRolls,
    receiveShipment,
    setReceiveShipment,
    receiving,
    setReceiving,
    load,
    effectiveWorkshopId,
    effectiveShiftNumber,
    filterMaterials,
    visibleShipments,
    shiftOptions,
    shiftOptionLabel,
    newCount,
    completedCount,
    activeFiltersCount,
    resetFilters,
    openCreate,
    dialogMaterials,
    requestWorkshopId,
    requestShiftNumber,
  };
};

export type ToWorkshopState = ReturnType<typeof useToWorkshopState>;

export default useToWorkshopState;
