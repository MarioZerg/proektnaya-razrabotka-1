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
  deleteShipment,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import RequestMaterialDialog from '@/components/crm/shipments/RequestMaterialDialog';
import ToWorkshopTable from '@/components/crm/shipments/ToWorkshopTable';
import AssembleShipmentView from '@/components/crm/shipments/AssembleShipmentView';

const ToWorkshop = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  const isAdmin = user?.role === 'admin';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reqWorkshopId, setReqWorkshopId] = useState('');
  const [reqShiftNumber, setReqShiftNumber] = useState('');
  const [reqComment, setReqComment] = useState('');
  const [reqMaterialId, setReqMaterialId] = useState('');
  const [reqQuantity, setReqQuantity] = useState('');

  const [activeShipment, setActiveShipment] = useState<ShipmentDetail | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

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

  const openCreate = () => {
    setReqWorkshopId(isProduction && user?.workshopId ? String(user.workshopId) : '');
    setReqShiftNumber(isProduction && user?.shiftNumber ? String(user.shiftNumber) : '');
    setReqComment('');
    setReqMaterialId('');
    setReqQuantity('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!isProduction && !reqWorkshopId) {
      toast({ title: 'Выберите цех', variant: 'destructive' });
      return;
    }
    if (isProduction && !user?.workshopId) {
      toast({ title: 'За вами не закреплён цех — обратитесь к администратору', variant: 'destructive' });
      return;
    }
    if (!reqMaterialId) {
      toast({ title: 'Выберите материал', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await requestToWorkshop({
        workshopId: isProduction ? Number(user!.workshopId) : Number(reqWorkshopId),
        shiftNumber: isProduction
          ? (user?.shiftNumber ?? undefined)
          : reqShiftNumber
            ? Number(reqShiftNumber)
            : undefined,
        comment: reqComment.trim() || undefined,
        materialId: Number(reqMaterialId),
        requestedQuantity: reqQuantity ? Number(reqQuantity) : undefined,
        requestedBy: user?.id,
      });
      toast({ title: 'Заявка отправлена кладовщику' });
      setCreateOpen(false);
      load();
      if (!isProduction) {
        const detail = await fetchShipmentDetail(res.id);
        setActiveShipment(detail);
      }
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
    setScanning(true);
    try {
      await collectScan(activeShipment.id, code);
      playScanSound();
      toast({ title: `Рулон ${code} добавлен` });
      setScanCode('');
      const detail = await fetchShipmentDetail(activeShipment.id);
      setActiveShipment(detail);
    } catch (e) {
      playScanErrorSound();
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      scanInputRef.current?.focus();
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

  const handleReceive = async (id: number) => {
    try {
      await receiveAtWorkshop(id);
      toast({ title: 'Поставка принята в цехе' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
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
                : 'Заявка от швеи/закройщика → сборка рулонов сканированием → отправка → приём в цехе'}
            </p>
          </div>
          <RequestMaterialDialog
            isProduction={isProduction}
            open={createOpen}
            onOpenChange={setCreateOpen}
            onOpenCreate={openCreate}
            workshops={workshops}
            materials={materials}
            reqWorkshopId={reqWorkshopId}
            setReqWorkshopId={setReqWorkshopId}
            reqShiftNumber={reqShiftNumber}
            setReqShiftNumber={setReqShiftNumber}
            reqMaterialId={reqMaterialId}
            setReqMaterialId={setReqMaterialId}
            reqQuantity={reqQuantity}
            setReqQuantity={setReqQuantity}
            reqComment={reqComment}
            setReqComment={setReqComment}
            creating={creating}
            onCreate={handleCreate}
          />
        </div>

        <ToWorkshopTable
          loading={loading}
          shipments={shipments}
          workshops={workshops}
          isProduction={isProduction}
          isAdmin={isAdmin}
          deleteId={deleteId}
          deleting={deleting}
          onOpenShipment={openShipment}
          onReceive={handleReceive}
          onSetDeleteId={setDeleteId}
          onDelete={handleDelete}
        />
      </div>
    </CrmLayout>
  );
};

export default ToWorkshop;