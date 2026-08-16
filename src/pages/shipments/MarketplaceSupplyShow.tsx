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
  addSewingOrdersToSupply,
  supplyStatusFlow,
  type SupplyDetail,
} from '@/lib/marketplaceSuppliesApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';
import { importOzonFboComposition } from '@/lib/ozonFboApi';
import { fetchWbSupplyQr } from '@/lib/wbFbsApi';
import { useAuth } from '@/context/AuthContext';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import OzonFboApplicationCard from '@/components/crm/marketplaceSupplies/OzonFboApplicationCard';
import GazelkaShippingCard from '@/components/crm/marketplaceSupplies/GazelkaShippingCard';
import SupplyHeader from '@/components/crm/marketplaceSupplies/SupplyHeader';
import SupplyFboFieldsCard from '@/components/crm/marketplaceSupplies/SupplyFboFieldsCard';
import SupplyItemsSection from '@/components/crm/marketplaceSupplies/SupplyItemsSection';
import SupplySewingSection from '@/components/crm/marketplaceSupplies/SupplySewingSection';
import AddSewingOrdersDialog from '@/components/crm/marketplaceSupplies/AddSewingOrdersDialog';
import SupplyGroupsPanel from '@/components/crm/marketplaceSupplies/SupplyGroupsPanel';
import WbFbsSupplyCard from '@/components/crm/marketplaceSupplies/WbFbsSupplyCard';
import WbFboSupplyCard from '@/components/crm/marketplaceSupplies/WbFboSupplyCard';

const MarketplaceSupplyShow = () => {
  const { id } = useParams();
  const supplyId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [importingFbo, setImportingFbo] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);

  const [supply, setSupply] = useState<SupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [supplyNumber, setSupplyNumber] = useState('');
  const [supplyBarcode, setSupplyBarcode] = useState('');
  const [cluster, setCluster] = useState('');
  const [gazelkaId, setGazelkaId] = useState('');
  const [comment, setComment] = useState('');

  const [readyGoods, setReadyGoods] = useState<GoodsWarehouseItem[]>([]);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>([]);
  const [addOrdersOpen, setAddOrdersOpen] = useState(false);
  const [addingOrders, setAddingOrders] = useState(false);

  const [scanOrderNumber, setScanOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [forceCompleting, setForceCompleting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Перезагрузка карточки.
   *
   * silent=true — обновляем данные, НЕ показывая экран «Загрузка...» вместо страницы.
   * Полноэкранный спиннер уместен только при первом открытии: если показывать его на
   * каждом фоновом обновлении, у кладовщика посреди сборки исчезает вся таблица и
   * теряется место в прокрутке.
   */
  const load = (silent = false) => {
    if (!silent) setLoading(true);
    // «Готово к сборке» — это вещи, застикерованные и ждущие отгрузки: сшитые в цехе
    // (awaiting_supply, лежат в контейнере) и снятые с полок (picking).
    Promise.all([
      fetchSupplyDetail(supplyId),
      Promise.all([
        fetchGoodsWarehouse('picking'),
        fetchGoodsWarehouse('awaiting_supply'),
      ]).then(([picked, ready]) => [...picked, ...ready]),
    ])
      .then(([data, goods]) => {
        setSupply(data);
        // Считаем готовым только то, что поедет ИМЕННО в эту поставку: своя площадка,
        // своя схема (FBS/FBO), а для FBO — ещё и свой кластер. Раньше счётчик брал весь
        // склад разом, и в поставке WB показывалось несколько десятков вещей для OZON.
        setReadyGoods(
          goods.filter(
            (g) =>
              g.marketplace === data.marketplace &&
              g.orderType === data.type &&
              (data.type !== 'FBO' || !data.cluster || g.cluster === data.cluster) &&
              // Без наклеенного ярлыка маркетплейса вещь в поставку не принимается —
              // сканер её развернёт. Считать такие «готовыми» нельзя: кладовщик видел
              // 82 шт, а отсканировать мог только 35, и искал по складу несуществующее.
              !!g.shippingLabeledAt &&
              // Уже лежит в какой-то поставке — либо в этой, либо в чужой. В обоих
              // случаях это не «готовое к сборке», сканировать её больше не нужно.
              (g.supplyId === null || g.supplyId === data.id),
          ),
        );
        setSupplyNumber(data.supplyNumber || '');
        setSupplyBarcode(data.supplyBarcode || '');
        setCluster(data.cluster || '');
        setGazelkaId(data.gazelkaId || '');
        setComment(data.comment || '');
      })
      // Счётчик готового считается из карточки поставки и склада вместе, поэтому запросы
      // не разделить. Ловим ошибку, чтобы обрыв связи не оставлял вечный кружок загрузки.
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Первое открытие карточки — здесь спиннер уместен: показывать пока нечего.
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyId]);

  // Справочник товаров нужен для догрузки в пошив — грузим один раз при открытии карточки.
  useEffect(() => {
    fetchMarketplaceItems().then(setMarketplaceItems).catch(() => setMarketplaceItems([]));
  }, []);

  const handleAddSewingOrders = async (
    rows: { marketplaceItemId: number; quantity: number }[],
  ) => {
    setAddingOrders(true);
    try {
      const res = await addSewingOrdersToSupply(supplyId, rows, { id: user?.id, name: user?.name });
      // Часть товара могла найтись готовой на складе — её шить не нужно, и менеджеру
      // важно видеть это сразу: экономия ткани и времени цеха.
      toast({
        title: `Добавлено в поставку: ${res.created} шт`,
        description: res.fromStock
          ? `Взято готовыми со склада: ${res.fromStock}, отправлено в пошив: ${res.toSewing}`
          : 'Всё отправлено в пошив — на складе готовых нет',
      });
      setAddOrdersOpen(false);
      load(true);
    } catch (e) {
      toast({
        title: 'Не удалось догрузить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setAddingOrders(false);
    }
  };

  const handleScanOrder = async () => {
    const orderNumber = scanOrderNumber.trim();
    if (!orderNumber) return;
    // Поле очищаем сразу, до ответа сервера — чтобы не было повторных отправок того же
    // номера при ошибке (автосканирование иначе попыталось бы отправить его снова).
    setScanOrderNumber('');
    setScanning(true);
    try {
      const res = await scanOrderToSupply(supplyId, orderNumber);
      playScanSound();
      // Заказ Яндекса из нескольких вещей уедет по одному ярлыку — пока собраны не все вещи,
      // напоминаем кладовщику, сколько осталось: отгрузить половину заказа система не даст.
      if (res.group && res.group.remaining > 0) {
        toast({
          title: `Заказ собран не полностью: ${res.group.inSupply} из ${res.group.total}`,
          description: `Отсканируйте ещё ${res.group.remaining} — у этого заказа общий ярлык`,
        });
      } else {
        toast({ title: `Заказ ${orderNumber} добавлен` });
      }

      // СТРОКУ ДОРИСОВЫВАЕМ САМИ, БЕЗ ПЕРЕЗАГРУЗКИ КАРТОЧКИ.
      //
      // Раньше здесь стоял load(): после каждого пика заново тянулась вся поставка —
      // 250 позиций, список ожидающих отгрузки, группы, заказы на пошив, сверка с OZON.
      // Кладовщик пикает быстрее, чем это грузится: таблица моргала и перерисовывалась
      // целиком, место в прокрутке терялось, а на большой поставке каждый скан стоил
      // несколько секунд ожидания.
      //
      // Теперь сервер возвращает готовую строку, и мы просто добавляем её в таблицу.
      // Заодно убираем вещь из «ожидают отгрузки» и уменьшаем счётчик — ровно то, что
      // сделала бы перезагрузка, но мгновенно и без единого лишнего запроса.
      if (res.item) {
        const added = res.item;
        setSupply((prev) => {
          if (!prev) return prev;
          // Защита от гонки: тот же товар мог прилететь дважды (двойной пик сканера,
          // повтор запроса). Строка с этим goodsWarehouseId должна быть одна.
          if (prev.items.some((i) => i.goodsWarehouseId === added.goodsWarehouseId)) {
            return prev;
          }
          return {
            ...prev,
            items: [...prev.items, added],
            awaitingItems: (prev.awaitingItems || []).filter(
              (a) => a.id !== added.goodsWarehouseId,
            ),
            awaitingShipCount: Math.max(0, (prev.awaitingShipCount ?? 1) - 1),
          };
        });
        // Счётчик «осталось отсканировать» считается по этому списку — вещь из него
        // уходит, иначе кладовщик видел бы её в остатке уже после скана.
        setReadyGoods((prev) => prev.filter((g) => g.id !== added.goodsWarehouseId));
      } else {
        // Сервер не прислал строку (старая версия или нештатный случай) — падаем
        // на прежнее поведение, чтобы таблица не разошлась с реальностью.
        load(true);
      }
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
      const res = await removeSupplyItem(itemId);
      // Вещь, сшитую под FBS-заказ, на полку не отправляем: она остаётся
      // застикерованной и ждёт следующей поставки. Стикер хранения не нужен.
      if (res.backToSupply) {
        toast({
          title: 'Товар убран из поставки',
          description: 'Вернулся в «На поставку» — можно отсканировать в следующую',
        });
        load(true);
        return;
      }
      // Вещь брали с полки — она едет обратно, а ярлык маркетплейса аннулируется.
      // Сразу печатаем стикер хранения: без него вещь попадёт на полку неопознанной.
      if (res.storageBarcode) {
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title: res.product,
          orderNumber: res.orderNumber,
        });
        toast({
          title: 'Товар убран из поставки',
          description: `Наклейте стикер хранения ${res.storageBarcode} и положите вещь на полку`,
        });
      } else {
        toast({ title: 'Товар убран из поставки' });
      }
      load(true);
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
      load(true);
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
      load(true);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // QR поставки WB. Обычно приходит сам при переводе в доставку — эта кнопка нужна,
  // если WB тогда ответил не сразу, чтобы кладовщик не искал стикер в кабинете.
  const handleLoadQr = async () => {
    setLoadingQr(true);
    try {
      await fetchWbSupplyQr(supplyId);
      load(true);
      toast({ title: 'Стикер загружен' });
    } catch (e) {
      toast({
        title: 'Не удалось получить стикер',
        description: (e as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoadingQr(false);
    }
  };

  const handleForceComplete = async () => {
    setForceCompleting(true);
    try {
      await forceCompleteSupply(supplyId);
      toast({ title: 'Поставка закрыта принудительно' });
      load(true);
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
      load(true);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setImportingFbo(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await deleteSupply(supplyId);
      toast({
        title: 'Поставка удалена',
        description: res.deletedOrders
          ? `Заодно убрано заказов на пошив: ${res.deletedOrders}`
          : undefined,
      });
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
  // FBS-поставку собирает кладовщик — он сканирует товары со своих полок. Менеджер такую
  // поставку только НАБЛЮДАЕТ в реальном времени: сборка идёт на складе, а не за его столом,
  // поэтому редактирование состава ему недоступно. FBO-поставки менеджера это не касается —
  // там товарный состав ведёт именно он.
  const isManagerRole = user?.role === 'manager';
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const canEditItems =
    (supply.status === 'Открытая' || supply.status === 'На сборке') &&
    !(isManagerRole && supply.type === 'FBS');
  // Удалять товар из FBS-поставки кладовщику нельзя: вещь уже отстикерована ярлыком
  // маркетплейса и учтена на площадке. Ошибочное удаление рвёт связь с отправлением и
  // отправляет вещь на полку, хотя покупатель её ждёт. Убрать позицию может только
  // администратор; отменённые заказы кладовщик кладёт на полку отдельной кнопкой.
  const canRemoveItems =
    canEditItems && !(supply.type === 'FBS' && !isManager);

  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  // WB FBO: данные поставки заполняются вручную (у WB нет API заявок FBO), но грузоперевозку
  // так же везём через Газельку — поэтому показываем тот же блок Газельки, что и у OZON FBO.
  const isWbFbo = supply.marketplace === 'WB' && supply.type === 'FBO';
  // Права по ролям для OZON FBO: менеджер (и админ) управляет заявкой Газельки, синхронизацией
  // и загрузкой товарного состава в пошив. Кладовщик — только печать стикеров, и только после
  // того как менеджер выбрал заявку Газельки и синхронизировал данные (появился ID отгрузки).
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
          readOnly={isManagerRole && supply.type === 'FBS'}
          nextStatus={nextStatus}
          nextStatusLabel={nextStatusLabel}
          saving={saving}
          forceCompleting={forceCompleting}
          onBack={() => navigate('/crm/shipments/to-marketplace')}
          onDelete={handleDelete}
          onForceComplete={handleForceComplete}
          onMoveStatus={handleMoveStatus}
          loadingQr={loadingQr}
          onLoadQr={handleLoadQr}
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

        {/* Пошив по поставке: менеджер видит, что уже сшито, и догружает недостающее.
            Показываем НАД товарным составом — сначала производство, потом сборка. */}
        {supply.type === 'FBO' && (
          <SupplySewingSection
            orders={supply.sewingOrders || []}
            canAdd={isManager && supply.status !== 'Отгрузка' && supply.status !== 'Выполнена'}
            onAdd={() => setAddOrdersOpen(true)}
          />
        )}

        {/* Связки заказов Яндекса: показываем НАД списком товаров, чтобы кладовщик увидел
            незакрытые связки сразу, а не после прокрутки всей поставки. */}
        <SupplyGroupsPanel
          groups={supply.groups || []}
          cancelledCount={supply.items.filter((i) => i.isCancelled).length}
        />

        {isWbFbs ? (
          <WbFbsSupplyCard supply={supply} supplyId={supplyId} onReload={load} />
        ) : (
          <SupplyItemsSection
            supply={supply}
            supplyId={supplyId}
            canEditItems={canEditItems}
            canRemoveItems={canRemoveItems}
            readyGoods={readyGoods}
            scanOrderNumber={scanOrderNumber}
            setScanOrderNumber={setScanOrderNumber}
            scanning={scanning}
            scanInputRef={scanInputRef}
            onScanOrder={handleScanOrder}
            onRemoveItem={handleRemoveItem}
            onNavigateAssemble={() => navigate(`/crm/shipments/to-marketplace/${supplyId}/assemble`)}
            onReload={load}
          />
        )}

        <AddSewingOrdersDialog
          open={addOrdersOpen}
          onOpenChange={setAddOrdersOpen}
          marketplaceItems={marketplaceItems}
          saving={addingOrders}
          onCreate={handleAddSewingOrders}
        />
      </div>
    </CrmLayout>
  );
};

export default MarketplaceSupplyShow;