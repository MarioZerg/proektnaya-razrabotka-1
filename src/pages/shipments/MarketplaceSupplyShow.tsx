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
import { importOzonFboComposition } from '@/lib/ozonFboApi';
import { useAuth } from '@/context/AuthContext';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import OzonFboApplicationCard from '@/components/crm/marketplaceSupplies/OzonFboApplicationCard';
import GazelkaShippingCard from '@/components/crm/marketplaceSupplies/GazelkaShippingCard';
import SupplyHeader from '@/components/crm/marketplaceSupplies/SupplyHeader';
import SupplyFboFieldsCard from '@/components/crm/marketplaceSupplies/SupplyFboFieldsCard';
import SupplyItemsSection from '@/components/crm/marketplaceSupplies/SupplyItemsSection';
import WbFbsSupplyCard from '@/components/crm/marketplaceSupplies/WbFbsSupplyCard';
import WbFboSupplyCard from '@/components/crm/marketplaceSupplies/WbFboSupplyCard';

const MarketplaceSupplyShow = () => {
  const { id } = useParams();
  const supplyId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [importingFbo, setImportingFbo] = useState(false);

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
    Promise.all([fetchSupplyDetail(supplyId), fetchGoodsWarehouse('picking')])
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
      // setTimeout — иначе .focus() сработает раньше, чем React снимет disabled с поля
      // после ререндера, и браузер молча проигнорирует вызов на задизейбленном инпуте.
      setTimeout(() => scanInputRef.current?.focus(), 0);
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

  // Загрузка/обновление товарного состава заявки OZON FBO: создаёт недостающие заказы на
  // конвейер из состава заявки на стороне OZON (только чтение состава, ничего не двигает на OZON).
  const handleImportFboComposition = async () => {
    if (!supply?.ozonSupplyOrderId) return;
    setImportingFbo(true);
    try {
      const res = await importOzonFboComposition(supply.ozonSupplyOrderId, { id: user?.id, name: user?.name });
      const parts = [`создано заказов: ${res.created}`];
      if (res.skippedNoItem) parts.push(`без товара: ${res.skippedNoItem}`);
      toast({
        title: 'Товарный состав загружен',
        description: `Товаров в заявке: ${res.totalItems}. ${parts.join(', ')}.`,
      });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setImportingFbo(false);
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

  const isWbFbs = supply.marketplace === 'WB' && supply.type === 'FBS';
  // Для WB FBS сборка и передача в доставку выполняются кнопками на карточке WB (они
  // синхронизируются с WildBerries), поэтому ручной переход статуса в шапке скрыт —
  // остаётся только финальное «Отметить выполненной» после отгрузки.
  const rawNextStatus = supplyStatusFlow[supplyStatusFlow.indexOf(supply.status) + 1];
  const nextStatus = isWbFbs && rawNextStatus !== 'Выполнена' ? undefined : rawNextStatus;
  const canEditItems = supply.status === 'Открытая' || supply.status === 'На сборке';
  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  // WB FBO: данные поставки заполняются вручную (у WB нет API заявок FBO), но грузоперевозку
  // так же везём через Газельку — поэтому показываем тот же блок Газельки, что и у OZON FBO.
  const isWbFbo = supply.marketplace === 'WB' && supply.type === 'FBO';
  // Права по ролям для OZON FBO: менеджер (и админ) управляет заявкой Газельки, синхронизацией
  // и загрузкой товарного состава в пошив. Кладовщик — только печать стикеров, и только после
  // того как менеджер выбрал заявку Газельки и синхронизировал данные (появился ID отгрузки).
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const gazelkaReady = !!supply.gazelkaPlanId && !!supply.gazelkaId;

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
            onImportComposition={isManager ? handleImportFboComposition : undefined}
            importing={importingFbo}
          />
        )}

        {isWbFbo && <WbFboSupplyCard supply={supply} onReload={load} isManager={isManager} />}

        {supply.type === 'FBO' && !isOzonFbo && !isWbFbo && (
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

        {(isOzonFbo || isWbFbo) && (
          <GazelkaShippingCard supply={supply} onReload={load} isManager={isManager} gazelkaReady={gazelkaReady} />
        )}

        {isWbFbs ? (
          <WbFbsSupplyCard supply={supply} supplyId={supplyId} onReload={load} />
        ) : (
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
        )}
      </div>
    </CrmLayout>
  );
};

export default MarketplaceSupplyShow;