import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchShipments,
  fetchShipmentDetail,
  requestToWorkshop,
  collectScan,
  removeScannedRoll,
  shipToWorkshop,
  receiveAtWorkshop,
  rejectWorkshopReceive,
  deleteShipment,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { getAccessZone } from '@/lib/roles';
import RequestMaterialDialog from '@/components/crm/shipments/RequestMaterialDialog';
import ToWorkshopTable from '@/components/crm/shipments/ToWorkshopTable';
import AssembleShipmentView from '@/components/crm/shipments/AssembleShipmentView';
import ReceiveConfirmDialog from '@/components/crm/shipments/ReceiveConfirmDialog';

type TabValue = 'new' | 'completed';

const ToWorkshop = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  const zone = getAccessZone(user?.role);

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

  // Вкладки: "Новые" — заявки в процессе (Новый/Отправлено), "Завершённые" — уже
  // закрытые (Получено/Выполнена — старые тестовые записи). Страница всегда
  // открывается на вкладке "Новые".
  const isCompletedStatus = (status: string) => status === 'Получено' || status === 'Выполнена';
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

  const openCreate = () => {
    setReqComment('');
    setReqMaterialId('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!effectiveWorkshopId) {
      toast({ title: 'За вами не закреплён цех — откройте смену на главной странице', variant: 'destructive' });
      return;
    }
    // Рулон, который в итоге попадёт в цех по этой заявке, обязан принадлежать смене —
    // без открытой смены заявку создать нельзя (проверяется и на сервере).
    if (!effectiveShiftNumber) {
      toast({ title: 'За вами не закреплена смена — откройте смену на главной странице', variant: 'destructive' });
      return;
    }
    if (!reqMaterialId) {
      toast({ title: 'Выберите материал', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await requestToWorkshop({
        workshopId: effectiveWorkshopId,
        shiftNumber: effectiveShiftNumber ?? undefined,
        comment: reqComment.trim() || undefined,
        materialId: Number(reqMaterialId),
        requestedBy: user?.id,
      });
      toast({ title: 'Заявка отправлена кладовщику' });
      setCreateOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const openShipment = async (id: number) => {
    const detail = await fetchShipmentDetail(id);
    setActiveShipment(detail);
  };

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code || !activeShipment) return;
    // Поле очищаем сразу, до ответа сервера — чтобы кладовщик не мог повторно нажать
    // "Добавить" с тем же значением, пока идёт запрос, и чтобы строка ввода не оставалась
    // с "зависшим" кодом при ошибке (иначе автосканирование попытается отправить его снова).
    setScanCode('');
    setScanning(true);
    try {
      await collectScan(activeShipment.id, code);
      playScanSound();
      toast({ title: `Рулон ${code} добавлен` });
      const detail = await fetchShipmentDetail(activeShipment.id);
      setActiveShipment(detail);
    } catch (e) {
      playScanErrorSound();
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      // setTimeout — иначе .focus() сработает раньше, чем React снимет disabled с поля
      // после ререндера, и браузер молча проигнорирует вызов на задизейбленном инпуте.
      setTimeout(() => scanInputRef.current?.focus(), 0);
    }
  };

  const handleRemoveRoll = async (itemId: number) => {
    if (!activeShipment) return;
    try {
      await removeScannedRoll(itemId);
      toast({ title: 'Рулон убран из заявки' });
      const detail = await fetchShipmentDetail(activeShipment.id);
      setActiveShipment(detail);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleShip = async () => {
    if (!activeShipment) return;
    try {
      await shipToWorkshop(activeShipment.id);
      toast({ title: 'Заявка отправлена в цех' });
      setActiveShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const toggleRolls = async (shipmentId: number) => {
    if (shipmentId in expandedRolls) {
      setExpandedRolls((prev) => {
        const next = { ...prev };
        delete next[shipmentId];
        return next;
      });
      return;
    }
    setLoadingRolls(shipmentId);
    try {
      const detail = await fetchShipmentDetail(shipmentId);
      setExpandedRolls((prev) => ({ ...prev, [shipmentId]: detail }));
    } finally {
      setLoadingRolls(null);
    }
  };

  const openReceiveDialog = async (id: number) => {
    const detail = await fetchShipmentDetail(id);
    setReceiveShipment(detail);
  };

  const handleAcceptReceive = async () => {
    if (!receiveShipment) return;
    setReceiving(true);
    try {
      await receiveAtWorkshop(receiveShipment.id);
      toast({ title: 'Заявка принята в цехе' });
      setReceiveShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReceiving(false);
    }
  };

  const handleRejectReceive = async (reason: string) => {
    if (!receiveShipment) return;
    setReceiving(true);
    try {
      await rejectWorkshopReceive(receiveShipment.id, reason);
      toast({ title: 'Отказ зафиксирован', description: 'Заявка останется у кладовщика до исправлений' });
      setReceiveShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setReceiving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteShipment(deleteId);
      toast({ title: 'Заявка удалена' });
      setDeleteId(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  if (activeShipment) {
    return (
      <CrmLayout>
        <AssembleShipmentView
          activeShipment={activeShipment}
          scanCode={scanCode}
          setScanCode={setScanCode}
          scanning={scanning}
          scanInputRef={scanInputRef}
          onBack={() => setActiveShipment(null)}
          onScan={handleScan}
          onShip={handleShip}
          onRemoveRoll={handleRemoveRoll}
        />
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Отгрузка в цех</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isProduction
                ? 'Запросите нужный материал — кладовщик соберёт рулоны и отправит вам'
                : 'Заявку создаёт сотрудник цеха → сборка рулонов сканированием → отправка → приём в цехе'}
            </p>
          </div>
          {isProduction && (
            <RequestMaterialDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              onOpenCreate={openCreate}
              materials={materials}
              reqMaterialId={reqMaterialId}
              setReqMaterialId={setReqMaterialId}
              reqComment={reqComment}
              setReqComment={setReqComment}
              creating={creating}
              onCreate={handleCreate}
            />
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <TabsList>
            <TabsTrigger value="new">Новые заявки ({newCount})</TabsTrigger>
            <TabsTrigger value="completed">Завершённые заявки ({completedCount})</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap gap-3">
          <Select value={materialFilter} onValueChange={setMaterialFilter}>
            <SelectTrigger className="sm:w-64">
              <SelectValue placeholder="Все материалы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все материалы</SelectItem>
              {filterMaterials.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Фильтр по цеху/смене нужен только админу и кладовщику — сотрудники цеха
              (швея/закройщик/упаковщик) и так видят только заявки своего цеха и смены,
              им выбирать нечего. */}
          {!isProduction && (
            <>
              <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue placeholder="Все цеха" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все цеха</SelectItem>
                  {workshops.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger className="sm:w-56">
                  <SelectValue placeholder="Все смены" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все смены</SelectItem>
                  {shiftOptions.map((num) => (
                    <SelectItem key={num} value={String(num)}>
                      {shiftOptionLabel(num)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        <ToWorkshopTable
          loading={loading}
          shipments={visibleShipments}
          workshops={workshops}
          zone={zone}
          userWorkshopId={effectiveWorkshopId}
          userShiftNumber={effectiveShiftNumber}
          expandedRolls={expandedRolls}
          loadingRolls={loadingRolls}
          onToggleRolls={toggleRolls}
          deleteId={deleteId}
          deleting={deleting}
          onOpenShipment={openShipment}
          onOpenReceiveDialog={openReceiveDialog}
          onSetDeleteId={setDeleteId}
          onDelete={handleDelete}
        />
      </div>

      <ReceiveConfirmDialog
        shipment={receiveShipment}
        onOpenChange={(open) => !open && setReceiveShipment(null)}
        saving={receiving}
        onAccept={handleAcceptReceive}
        onReject={handleRejectReceive}
      />
    </CrmLayout>
  );
};

export default ToWorkshop;