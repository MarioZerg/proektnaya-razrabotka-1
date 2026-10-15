import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { printStorageSticker } from '@/lib/printStorageSticker';
import type { SupplyDetail, WbSupplyOrder } from '@/lib/marketplaceSuppliesApi';
import {
  createWbSupply,
  scanWbOrderToSupply,
  deliverWbSupply,
  removeWbOrderFromSupply,
  shelfCancelledOrder,
} from '@/lib/wbFbsApi';
import WbFbsSupplyToolbar from './WbFbsSupplyToolbar';
import WbFbsScanPanel from './WbFbsScanPanel';
import WbFbsB2bNotices from './WbFbsB2bNotices';
import WbFbsOrdersTable from './WbFbsOrdersTable';
import { fixScanLayout } from '@/lib/keyboardLayout';

interface WbFbsSupplyCardProps {
  supply: SupplyDetail;
  supplyId: number;
  onReload: () => void;
  /** Дорисовать отсканированный заказ в таблицу без перезагрузки карточки. */
  onScanned: (order: WbSupplyOrder, supplyStatus?: string) => void;
}

/** Карточка сборки WB FBS-поставки: создание поставки на стороне WildBerries, сканирование
 * готовых заказов в поставку (со счётчиками готово/отсканировано), передача в доставку и
 * отображение стикеров коробов, которые WB возвращает при закрытии. */
const WbFbsSupplyCard = ({ supply, supplyId, onReload, onScanned }: WbFbsSupplyCardProps) => {
  const { toast } = useToast();
  const [creatingSupply, setCreatingSupply] = useState(false);
  const [scanValue, setScanValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [shelvingId, setShelvingId] = useState<number | null>(null);

  const wbCreated = !!supply.wbSupplyId;
  const canScan = wbCreated && (supply.status === 'Открытая' || supply.status === 'На сборке');
  const canDeliver = wbCreated && supply.wbOrders.length > 0 && supply.status === 'На сборке';

  // Что ещё лежит в резервной поставке WB и ждёт сканирования. Список приходит с сервера
  // тем же условием, что и счётчик «Ожидают отгрузки», поэтому числа сходятся.
  const scannedOrders = new Set(supply.wbOrders.map((o) => o.orderNumber));
  const allAwaiting = (supply.wbAwaitingItems || []).filter(
    (a) => !a.orderNumber || !scannedOrders.has(a.orderNumber),
  );
  // ЗАКАЗЫ ЮРЛИЦ (B2B). WB не принимает поставку, где они смешаны с обычными.
  // Тип поставки кладовщик выбрал при создании: в чек-листе показываем только
  // подходящие вещи, остальные ждут своей поставки.
  const supplyIsB2b = !!supply.isB2b;
  const wbAwaiting = allAwaiting.filter((a) => !!a.isB2b === supplyIsB2b);
  const otherKindCount = allAwaiting.length - wbAwaiting.length;
  const canRemove = supply.status === 'Открытая' || supply.status === 'На сборке';

  const handleRemove = async (orderId: number, orderNumber: string) => {
    setRemovingId(orderId);
    try {
      await removeWbOrderFromSupply(supplyId, orderId);
      toast({ title: `Заказ ${orderNumber} убран из поставки` });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  // Покупатель отказался, пока вещь ехала в короб: убираем её из поставки (и с WB),
  // вещь уходит на полку склада и ждёт нового покупателя.
  const handleShelf = async (orderId: number, orderNumber: string) => {
    setShelvingId(orderId);
    try {
      const r = await shelfCancelledOrder(supplyId, orderId);
      // СТИКЕР ХРАНЕНИЯ ПЕЧАТАЕМ СРАЗУ.
      //
      // Раньше система только писала «наклейте стикер GW-…», а печатать его
      // было неоткуда: кладовщик оставался с вещью, на которой висит уже
      // недействительный ярлык WB, и без складского стикера. Опознать её на
      // полке и отсканировать в подбор потом невозможно.
      printStorageSticker({
        storageBarcode: r.storageBarcode,
        title: r.product,
        orderNumber: r.orderNumber,
      });
      toast({
        title: `Заказ ${orderNumber} убран из поставки`,
        description: `Снимите ярлык WB, наклейте стикер хранения ${r.storageBarcode} — вещь едет на полку`,
      });
      onReload();
    } catch (e) {
      toast({
        title: 'Не удалось убрать заказ',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setShelvingId(null);
    }
  };

  // Поставку на стороне WB создаём САМИ, как только кладовщик её открыл.
  //
  // Раньше он видел пустой экран с кнопкой «Создать поставку на WB» и только после
  // нажатия получал сканер. Шаг был лишним: заявка на WB и есть поставка, отдельного
  // решения тут не принимается. Теперь сканер доступен сразу.
  useEffect(() => {
    if (wbCreated || creatingSupply) return;
    if (supply.status !== 'Открытая' && supply.status !== 'На сборке') return;
    setCreatingSupply(true);
    createWbSupply(supplyId)
      .then(() => onReload())
      .catch(() => {
        // Молча не падаем: если WB недоступен, кладовщик нажмёт кнопку вручную.
      })
      .finally(() => setCreatingSupply(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbCreated, supply.status]);

  const handleCreateSupply = async () => {
    setCreatingSupply(true);
    try {
      const r = await createWbSupply(supplyId);
      toast({
        title: r.alreadyCreated ? 'Поставка уже создана на WB' : 'Поставка создана на WildBerries',
        description: `ID поставки WB: ${r.wbSupplyId}`,
      });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreatingSupply(false);
    }
  };

  const handleScan = async () => {
    const orderNumber = fixScanLayout(scanValue.trim());
    if (!orderNumber) return;
    setScanValue('');
    setScanning(true);
    try {
      const res = await scanWbOrderToSupply(supplyId, orderNumber);
      playScanSound();
      toast({ title: `Заказ ${orderNumber} добавлен в поставку` });

      // СТРОКУ ДОРИСОВЫВАЕМ САМИ, БЕЗ ПЕРЕЗАГРУЗКИ КАРТОЧКИ.
      //
      // Раньше здесь стоял onReload(): после каждого пика заново тянулась вся
      // поставка со списками и стикерами. Кладовщик сканирует быстрее, чем это
      // грузится: таблица моргала, место в прокрутке терялось, а на большой
      // поставке каждый скан стоил несколько секунд ожидания.
      //
      // Теперь сервер возвращает готовую строку — просто добавляем её в таблицу
      // и убираем вещь из «ожидают сканирования». Ровно то, что сделала бы
      // перезагрузка, но мгновенно и без единого лишнего запроса.
      if (res.order) {
        onScanned(res.order, res.supplyStatus);
      } else {
        // Сервер не прислал строку (нештатный случай) — падаем на прежнее
        // поведение, чтобы таблица не разошлась с реальностью.
        onReload();
      }
    } catch (e) {
      playScanErrorSound();
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      setTimeout(() => scanRef.current?.focus(), 0);
    }
  };

  const handleDeliver = async () => {
    setDelivering(true);
    try {
      const r = await deliverWbSupply(supplyId);
      // Про QR поставки говорим отдельно: это тот лист, который водитель показывает
      // на складе WB. Если он не пришёл, кладовщик должен узнать сразу, а не у ворот.
      toast({
        title: r.sandbox ? 'WB (тест): поставка передана в доставку' : 'Поставка передана в доставку',
        description: r.qrWarning
          ? `QR поставки пока не пришёл — нажмите «Загрузить стикер WB». ${r.qrWarning}`
          : r.stickersSaved > 0
            ? `QR поставки получен. Стикеров коробов: ${r.stickersSaved}`
            : 'QR поставки получен',
        variant: r.qrWarning ? 'destructive' : undefined,
      });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setDelivering(false);
    }
  };

  useScannerAutoSubmit(scanValue, handleScan, !scanning && canScan);

  return (
    <div className="space-y-3">
      <WbFbsSupplyToolbar
        supply={supply}
        canDeliver={canDeliver}
        delivering={delivering}
        onDeliver={handleDeliver}
      />

      <WbFbsScanPanel
        wbCreated={wbCreated}
        creatingSupply={creatingSupply}
        onCreateSupply={handleCreateSupply}
        canScan={canScan}
        scanRef={scanRef}
        scanValue={scanValue}
        setScanValue={setScanValue}
        scanning={scanning}
        onScan={handleScan}
      />

      {/* Чек-лист сборки: сверху зелёным то, что уже отсканировано, ниже — что ещё
          лежит в резерве и ждёт кладовщика. Пикнул ярлык — строка позеленела. */}
      <WbFbsB2bNotices supplyIsB2b={supplyIsB2b} otherKindCount={otherKindCount} />
      <WbFbsOrdersTable
        wbOrders={supply.wbOrders}
        wbAwaiting={wbAwaiting}
        canRemove={canRemove}
        removingId={removingId}
        shelvingId={shelvingId}
        onRemove={handleRemove}
        onShelf={handleShelf}
      />
    </div>
  );
};

export default WbFbsSupplyCard;
