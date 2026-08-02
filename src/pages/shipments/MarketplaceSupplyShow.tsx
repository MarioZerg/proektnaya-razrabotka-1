import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchSupplyDetail,
  removeSupplyItem,
  scanOrderToSupply,
  updateSupply,
  moveSupplyStatus,
  forceCompleteSupply,
  deleteSupply,
  supplyStatusFlow,
  type SupplyDetail,
} from '@/lib/marketplaceSuppliesApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import OzonFboApplicationCard from '@/components/crm/marketplaceSupplies/OzonFboApplicationCard';
import SupplyHeader from '@/components/crm/marketplaceSupplies/SupplyHeader';
import SupplyFboFieldsCard from '@/components/crm/marketplaceSupplies/SupplyFboFieldsCard';
import SupplyItemsSection from '@/components/crm/marketplaceSupplies/SupplyItemsSection';

const MarketplaceSupplyShow = () => {
  const { id } = useParams();
  const supplyId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [supply, setSupply] = useState<SupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [supplyNumber, setSupplyNumber] = useState('');
  const [supplyBarcode, setSupplyBarcode] = useState('');
  const [cluster, setCluster] = useState('');
  const [gazelkaId, setGazelkaId] = useState('');
  const [comment, setComment] = useState('');

  const [readyGoods, setReadyGoods] = useState<GoodsWarehouseItem[]>([]);

  const [scanOrderNumber, setScanOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [forceCompleting, setForceCompleting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const load = () => {
    setLoading(true);
    Promise.all([fetchSupplyDetail(supplyId), fetchGoodsWarehouse('in_stock')])
      .then(([data, goods]) => {
        setSupply(data);
        setReadyGoods(goods);
        setSupplyNumber(data.supplyNumber || '');
        setSupplyBarcode(data.supplyBarcode || '');
        setCluster(data.cluster || '');
        setGazelkaId(data.gazelkaId || '');
        setComment(data.comment || '');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyId]);

  const handleScanOrder = async () => {
    const orderNumber = scanOrderNumber.trim();
    if (!orderNumber) return;
    // Поле очищаем сразу, до ответа сервера — чтобы не было повторных отправок того же
    // номера при ошибке (автосканирование иначе попыталось бы отправить его снова).
    setScanOrderNumber('');
    setScanning(true);
    try {
      await scanOrderToSupply(supplyId, orderNumber);
      playScanSound();
      toast({ title: `Заказ ${orderNumber} добавлен` });
      load();
    } catch (e) {
      playScanErrorSound();
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      scanInputRef.current?.focus();
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    try {
      await removeSupplyItem(itemId);
      toast({ title: 'Товар убран из поставки' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleSaveFields = async () => {
    setSaving(true);
    try {
      await updateSupply(supplyId, {
        supplyNumber,
        supplyBarcode,
        cluster,
        gazelkaId,
        comment,
      });
      toast({ title: 'Данные поставки сохранены' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOzonFboFields = async (fields: {
    gazelkaId: string;
    shipToGazelkaAt: string;
    packagingType: 'boxes' | 'pallets' | '';
    packagingCount: string;
    gazelkaPickup: boolean;
  }) => {
    setSaving(true);
    try {
      await updateSupply(supplyId, {
        gazelkaId: fields.gazelkaId,
        shipToGazelkaAt: fields.shipToGazelkaAt,
        packagingType: fields.packagingType,
        packagingCount: fields.packagingCount ? Number(fields.packagingCount) : null,
        gazelkaPickup: fields.gazelkaPickup,
      });
      toast({ title: 'Данные заявки сохранены' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleMoveStatus = async () => {
    if (!supply) return;
    const idx = supplyStatusFlow.indexOf(supply.status);
    const next = supplyStatusFlow[idx + 1];
    if (!next) return;
    setSaving(true);
    try {
      await moveSupplyStatus(supplyId, next);
      toast({ title: `Статус изменён на «${next}»` });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleForceComplete = async () => {
    setForceCompleting(true);
    try {
      await forceCompleteSupply(supplyId);
      toast({ title: 'Поставка закрыта принудительно' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setForceCompleting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSupply(supplyId);
      toast({ title: 'Поставка удалена' });
      navigate('/crm/shipments/to-marketplace');
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  if (loading || !supply) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  const nextStatus = supplyStatusFlow[supplyStatusFlow.indexOf(supply.status) + 1];
  const canEditItems = supply.status === 'Открытая' || supply.status === 'На сборке';
  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';

  const nextStatusLabel: Record<string, string> = {
    'На сборке': 'Взять на сборку',
    Отгрузка: supply.type === 'FBS' ? 'Закрыть поставку и передать в доставку' : 'Отгрузить в Газельку',
    Выполнена: 'Отметить выполненной',
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <SupplyHeader
          supply={supply}
          isOzonFbo={isOzonFbo}
          now={now}
          nextStatus={nextStatus}
          nextStatusLabel={nextStatusLabel}
          saving={saving}
          forceCompleting={forceCompleting}
          onBack={() => navigate('/crm/shipments/to-marketplace')}
          onDelete={handleDelete}
          onForceComplete={handleForceComplete}
          onMoveStatus={handleMoveStatus}
        />

        {isOzonFbo && (
          <OzonFboApplicationCard
            supply={supply}
            canEdit={canEditItems}
            saving={saving}
            onSave={handleSaveOzonFboFields}
          />
        )}

        {supply.type === 'FBO' && !isOzonFbo && (
          <SupplyFboFieldsCard
            supply={supply}
            supplyNumber={supplyNumber}
            setSupplyNumber={setSupplyNumber}
            supplyBarcode={supplyBarcode}
            setSupplyBarcode={setSupplyBarcode}
            cluster={cluster}
            setCluster={setCluster}
            gazelkaId={gazelkaId}
            setGazelkaId={setGazelkaId}
            comment={comment}
            setComment={setComment}
            saving={saving}
            onSave={handleSaveFields}
          />
        )}

        <SupplyItemsSection
          supply={supply}
          supplyId={supplyId}
          canEditItems={canEditItems}
          readyGoods={readyGoods}
          scanOrderNumber={scanOrderNumber}
          setScanOrderNumber={setScanOrderNumber}
          scanning={scanning}
          scanInputRef={scanInputRef}
          onScanOrder={handleScanOrder}
          onRemoveItem={handleRemoveItem}
          onNavigateAssemble={() => navigate(`/crm/shipments/to-marketplace/${supplyId}/assemble`)}
        />
      </div>
    </CrmLayout>
  );
};

export default MarketplaceSupplyShow;