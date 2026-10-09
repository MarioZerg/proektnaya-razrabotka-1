import { useEffect, useRef, useState } from 'react';
import KioskSendToRepairDialog from '@/components/crm/kiosk/KioskSendToRepairDialog';
import RepackScanPanel from '@/components/crm/kiosk/repack/RepackScanPanel';
import RepackDialogs from '@/components/crm/kiosk/repack/RepackDialogs';
import RepackEmptyState from '@/components/crm/kiosk/repack/RepackEmptyState';
import RepackItemCard from '@/components/crm/kiosk/repack/RepackItemCard';
import { useToast } from '@/hooks/use-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printDisposeSticker } from '@/lib/printDisposeSticker';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import {
  fetchRepackCount,
  scanRepackItem,
  finishRepack,
  clearRepackQueue,
  type RepackItem,
} from '@/lib/kioskApi';

interface KioskRepackScreenProps {
  actorId: number;
  actorName: string;
  /** Цех этого киоска: перепаковка у каждого цеха своя. */
  workshopId: number | null;
  /** Очистка очереди только у админа — упаковщица кнопку не видит и не нажмёт. */
  isAdmin?: boolean;
}

/**
 * Перепаковка возвратов — работа строго через сканер.
 *
 * Список всех вещей на экране НЕ показываем. Раньше он выводился целиком: две
 * упаковщицы видели одни и те же два десятка карточек, листали их, искали свою
 * вещь глазами и могли нажать кнопку не на той строке. Вещь физически лежит одна,
 * а решение по ней принимали двое.
 *
 * Теперь на экране только поле сканера и ОДНА вещь — та, что упаковщица держит в
 * руках. Отсканировала — увидела, что это, и приняла решение. Ошибиться строкой
 * невозможно, потому что строка одна.
 *
 * Сканируется то, что реально осталось на вернувшемся пакете: наклейка возврата или
 * ярлык отправления, с которым вещь ездила к покупателю (OZON, WB, Яндекс). Стикер
 * хранения GW-xxxxxx сюда не входит — упаковщица его не сканирует, а печатает на
 * отказные вещи, уезжающие на полку.
 *
 * Ищется вещь ТОЛЬКО среди переведённых кладовщиком на перепаковку — активный заказ,
 * который вот-вот уедет покупателю, сюда не попадёт даже случайным сканом.
 */
const KioskRepackScreen = ({
  actorId,
  actorName,
  workshopId,
  isAdmin = false,
}: KioskRepackScreenProps) => {
  const { toast } = useToast();
  /** Единственная вещь на экране — только что отсканированная. */
  const [item, setItem] = useState<RepackItem | null>(null);
  const { busy: processing, run } = useSubmitGuard();
  const [note, setNote] = useState('');
  /** Спрашиваем про новый пакет перед закрытием перепаковки. */
  const [bagAsk, setBagAsk] = useState(false);
  /** Окно возврата годного куска материала на рулон при перекрое. */
  const [repairOpen, setRepairOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  /** Сколько вещей ждёт перепаковки в цехе — объём работы без вывода списка. */
  const [waiting, setWaiting] = useState(0);
  const [countError, setCountError] = useState<string | null>(null);
  /** Сколько вещей упаковщица закрыла за эту смену на экране. */
  const [doneCount, setDoneCount] = useState(0);
  /** Подтверждение очистки очереди — без него случайное нажатие сотрёт работу. */
  const [clearAsk, setClearAsk] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const anyDialog = bagAsk || repairOpen || clearAsk;

  const focusInput = () => {
    if (anyDialog || item) return;
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const loadCount = () => {
    fetchRepackCount(workshopId)
      .then((r) => {
        setCountError(null);
        setWaiting(r.mineCount + r.freeCount);
      })
      .catch((e) => {
        setCountError(e instanceof Error ? e.message : 'Не удалось узнать очередь');
      });
  };

  useEffect(() => {
    // Греем звук заранее: первый скан должен прозвучать сразу.
    primeScanSounds();
    loadCount();
    focusInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId]);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code || scanning) return;
    setBarcode('');
    setScanning(true);
    setScanError(null);
    try {
      const found = await scanRepackItem(code, workshopId, actorId);
      playScanSound();
      setItem(found);
      // Отметки дефектов от предыдущей вещи не переносим: это другая вещь.
      setNote('');
    } catch (e) {
      playScanErrorSound();
      setScanError(e instanceof Error ? e.message : 'Не удалось отсканировать');
      setItem(null);
    } finally {
      setScanning(false);
      focusInput();
    }
  };

  // Сканер работает, только пока на экране нет вещи: сначала закончи с той, что в
  // руках, потом бери следующую. Иначе упаковщица пикает пакеты подряд, а решения
  // по ним теряются.
  useScannerAutoSubmit(barcode, handleScan, !scanning && !item && !anyDialog);

  const handleClearQueue = () => {
    if (!isAdmin) return;
    void run(async () => {
      setClearAsk(false);
      try {
        const res = await clearRepackQueue({ actorId, actorName, workshopId });
        setItem(null);
        setNote('');
        loadCount();
        toast({
          title: res.cleared
            ? `Очередь очищена · ${res.cleared} шт.`
            : 'Очередь уже пуста',
          description:
            'Кладовщик заново отправит на перепаковку вещи, которые забрал с маркетплейса',
        });
        focusInput();
      } catch (e) {
        toast({
          title: 'Не удалось очистить очередь',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleFinish = (outcome: 'repacked' | 'utilized', newBag?: boolean) => {
    if (!item) return;
    // Причину брака упаковщица больше не выбирает — на экране только три
    // решения: перепаковать, в брак, вернуть на рулон. Разбираться, ЧТО именно
    // с вещью не так, всё равно будет администратор, когда вещь дойдёт до него
    // со стикером. Лишний экран выбора только тормозил работу на потоке.
    const current = item;
    const text = note.trim() || 'Брак при перепаковке';
    void run(async () => {
      setBagAsk(false);
      setItem(null);
      try {
        const res = await finishRepack({
          id: current.id,
          outcome,
          newBag,
          note: text,
          actorId,
          actorName,
          workshopId,
        });

        const title =
          current.material && current.width
            ? `${current.material} ${current.width}×${current.height}`
            : current.product;

        if (outcome === 'repacked' && res.storageBarcode) {
          // Печатаем стикер хранения сразу: кладовщик по нему положит вещь на полку.
          printStorageSticker({
            storageBarcode: res.storageBarcode,
            title,
            orderNumber: current.orderNumber,
          });
          toast({
            title: res.accrued ? `Вещь переупакована · +${res.accrued} ₽` : 'Вещь переупакована',
            description: 'Наклейте стикер хранения — кладовщик заберёт вещь на полку',
          });
        } else {
          // Бракованную вещь тоже стикеруем: без наклейки она уезжает из цеха безымянной,
          // и на складе никто не знает, что это и за что списано.
          if (res.storageBarcode) {
            printDisposeSticker({
              storageBarcode: res.storageBarcode,
              title,
              orderNumber: current.orderNumber,
              reason: res.disposeReason || text,
            });
          }
          toast({
            title: 'Товар отправлен на утилизацию',
            description: 'Наклейте стикер брака — кладовщик передаст вещь администратору',
          });
        }

        // Экран очищаем полностью: следующая вещь начинается с чистого скана.
        setNote('');
        setDoneCount((n) => n + 1);
        loadCount();
        focusInput();
      } catch (e) {
        setItem(current);
        toast({
          title: 'Ошибка',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <div className="space-y-4">
      <RepackScanPanel
        item={item}
        countError={countError}
        onRetryCount={loadCount}
        waiting={waiting}
        doneCount={doneCount}
        inputRef={inputRef}
        barcode={barcode}
        onBarcodeChange={setBarcode}
        onScan={handleScan}
        onInputBlur={focusInput}
        scanning={scanning}
        clearAsk={clearAsk}
        scanError={scanError}
      />

      {/* Новый пакет? Спрашиваем перед закрытием перепаковки — по этим ответам видно
          реальный расход упаковки на возвратах. Кнопки крупные: экран сенсорный. */}
      <KioskSendToRepairDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        goodsWarehouseId={item?.id}
        material={item?.material}
        width={item?.width}
        height={item?.height}
        orderNumber={item?.orderNumber}
        onSent={() => {
          // Вещь ушла в материал: чистим экран и обновляем счётчик очереди,
          // как после обычного завершения.
          setItem(null);
          setNote('');
          setDoneCount((n) => n + 1);
          loadCount();
          focusInput();
        }}
      />

      <RepackDialogs
        isAdmin={isAdmin}
        clearAsk={clearAsk}
        setClearAsk={setClearAsk}
        waiting={waiting}
        processing={processing}
        onClearQueue={handleClearQueue}
        bagAsk={bagAsk}
        setBagAsk={setBagAsk}
        item={item}
        onFinish={handleFinish}
      />

      {!item ? (
        <RepackEmptyState
          countError={countError}
          waiting={waiting}
          isAdmin={isAdmin}
          processing={processing}
          onAskClear={() => setClearAsk(true)}
        />
      ) : (
        <RepackItemCard
          item={item}
          processing={processing}
          onRepack={() => setBagAsk(true)}
          onUtilize={() => handleFinish('utilized')}
          onRepair={() => setRepairOpen(true)}
          onWrongItem={() => {
            setItem(null);
            setNote('');
            focusInput();
          }}
        />
      )}
    </div>
  );
};

export default KioskRepackScreen;