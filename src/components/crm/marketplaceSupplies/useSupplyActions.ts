import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import {
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
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { importOzonFboComposition } from '@/lib/ozonFboApi';
import { fetchWbSupplyQr } from '@/lib/wbFbsApi';
import { useAuth } from '@/context/AuthContext';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';

interface UseSupplyActionsArgs {
  supplyId: number;
  supply: SupplyDetail | null;
  setSupply: Dispatch<SetStateAction<SupplyDetail | null>>;
  setReadyGoods: Dispatch<SetStateAction<GoodsWarehouseItem[]>>;
  load: (silent?: boolean) => void;
  fields: {
    supplyNumber: string;
    supplyBarcode: string;
    cluster: string;
    gazelkaId: string;
    comment: string;
  };
}

/**
 * Все действия карточки поставки: сканирование, удаление позиции, сохранение полей,
 * смена статуса, QR WB, принудительное закрытие, импорт состава FBO, удаление.
 *
 * Вынесено из страницы 1:1 — тексты уведомлений, порядок вызовов и обработка ошибок
 * не менялись.
 */
export const useSupplyActions = ({
  supplyId,
  supply,
  setSupply,
  setReadyGoods,
  load,
  fields,
}: UseSupplyActionsArgs) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [saving, setSaving] = useState(false);
  const [importingFbo, setImportingFbo] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);
  const [forceCompleting, setForceCompleting] = useState(false);

  const [addOrdersOpen, setAddOrdersOpen] = useState(false);
  const [addingOrders, setAddingOrders] = useState(false);

  const [scanOrderNumber, setScanOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

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
        supplyNumber: fields.supplyNumber,
        supplyBarcode: fields.supplyBarcode,
        cluster: fields.cluster,
        gazelkaId: fields.gazelkaId,
        comment: fields.comment,
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

  return {
    saving,
    importingFbo,
    loadingQr,
    forceCompleting,
    addOrdersOpen,
    setAddOrdersOpen,
    addingOrders,
    scanOrderNumber,
    setScanOrderNumber,
    scanning,
    scanInputRef,
    handleAddSewingOrders,
    handleScanOrder,
    handleRemoveItem,
    handleSaveFields,
    handleMoveStatus,
    handleLoadQr,
    handleForceComplete,
    handleImportFboComposition,
    handleDelete,
  };
};

export default useSupplyActions;
