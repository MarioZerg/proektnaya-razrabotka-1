import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
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

const ToWorkshop = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  const zone = getAccessZone(user?.role);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
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
    Promise.all([fetchShipments('to_workshop'), fetchWorkshops(), fetchMaterialsData()])
      .then(([shipmentsData, workshopsData, materialsData]) => {
        setShipments(shipmentsData);
        setWorkshops(workshopsData);
        setMaterials(materialsData.materials);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (activeShipment) scanInputRef.current?.focus();
  }, [activeShipment]);

  // Швея/закройщик/упаковщик видит только заявки СВОЕГО цеха и смены — не весь список.
  // Заявка без указанной смены (shiftNumber === null) относится ко всем сменам этого цеха.
  // Кладовщик и админ видят полный список, как и раньше.
  const visibleShipments = isProduction
    ? shipments.filter(
        (s) =>
          s.workshopId === user?.workshopId &&
          (s.shiftNumber === null || s.shiftNumber === user?.shiftNumber)
      )
    : shipments;

  const openCreate = () => {
    setReqComment('');
    setReqMaterialId('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!user?.workshopId) {
      toast({ title: 'За вами не закреплён цех — обратитесь к администратору', variant: 'destructive' });
      return;
    }
    if (!reqMaterialId) {
      toast({ title: 'Выберите материал', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await requestToWorkshop({
        workshopId: Number(user.workshopId),
        shiftNumber: user?.shiftNumber ?? undefined,
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
        <div className="flex items-center justify-between">
          <div>
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

        <ToWorkshopTable
          loading={loading}
          shipments={visibleShipments}
          workshops={workshops}
          zone={zone}
          userWorkshopId={user?.workshopId ?? null}
          userShiftNumber={user?.shiftNumber ?? null}
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