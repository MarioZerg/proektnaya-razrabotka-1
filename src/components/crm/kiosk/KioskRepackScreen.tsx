import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import KioskReturnToRollDialog from '@/components/crm/kiosk/KioskReturnToRollDialog';
import { useToast } from '@/hooks/use-toast';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printDisposeSticker } from '@/lib/printDisposeSticker';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import {
  fetchRepackCount,
  scanRepackItem,
  finishRepack,
  type RepackItem,
} from '@/lib/kioskApi';

interface KioskRepackScreenProps {
  actorId: number;
  actorName: string;
  /** Цех этого киоска: перепаковка у каждого цеха своя. */
  workshopId: number | null;
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
 * Сканировать можно любой код, которым помечен пакет: наш стикер хранения, ярлык
 * возврата маркетплейса или номер отправления. Ищется вещь ТОЛЬКО среди переведённых
 * кладовщиком на перепаковку — активный заказ, который вот-вот уедет покупателю, сюда
 * не попадёт даже случайным сканом.
 */
const KioskRepackScreen = ({ actorId, actorName, workshopId }: KioskRepackScreenProps) => {
  const { toast } = useToast();
  /** Единственная вещь на экране — только что отсканированная. */
  const [item, setItem] = useState<RepackItem | null>(null);
  const [processing, setProcessing] = useState(false);
  const [note, setNote] = useState('');
  /** Спрашиваем про новый пакет перед закрытием перепаковки. */
  const [bagAsk, setBagAsk] = useState(false);
  /** Окно возврата годного куска материала на рулон при перекрое. */
  const [rollReturnOpen, setRollReturnOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  /** Сколько вещей ждёт перепаковки в цехе — объём работы без вывода списка. */
  const [waiting, setWaiting] = useState(0);
  /** Сколько вещей упаковщица закрыла за эту смену на экране. */
  const [doneCount, setDoneCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  const loadCount = () => {
    fetchRepackCount(workshopId).then((r) => setWaiting(r.mineCount + r.freeCount));
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
      const found = await scanRepackItem(code, workshopId);
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
  useScannerAutoSubmit(barcode, handleScan, !scanning && !item);

  const handleFinish = async (outcome: 'repacked' | 'utilized', newBag?: boolean) => {
    if (!item) return;
    const text = note.trim();
    if (outcome === 'utilized' && !text) {
      toast({
        title: 'Опишите брак',
        description: 'Администратор должен видеть, за что списан товар',
        variant: 'destructive',
      });
      return;
    }
    setProcessing(true);
    setBagAsk(false);
    try {
      const res = await finishRepack({
        id: item.id,
        outcome,
        newBag,
        note: text,
        actorId,
        actorName,
        workshopId,
      });

      const title =
        item.material && item.width
          ? `${item.material} ${item.width}×${item.height}`
          : item.product;

      if (outcome === 'repacked' && res.storageBarcode) {
        // Печатаем стикер хранения сразу: кладовщик по нему положит вещь на полку.
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title,
          orderNumber: item.orderNumber,
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
            orderNumber: item.orderNumber,
            reason: res.disposeReason || text,
          });
        }
        toast({
          title: 'Товар отправлен на утилизацию',
          description: 'Наклейте стикер брака — кладовщик передаст вещь администратору',
        });
      }

      // Экран очищаем полностью: следующая вещь начинается с чистого скана.
      setItem(null);
      setNote('');
      setDoneCount((n) => n + 1);
      loadCount();
      focusInput();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const defects = [
    'Дырка',
    'Затяжка',
    'Пятно',
    'Брак шва',
    'Не тот размер',
    'Мятая',
    'Грязная',
    'Без дефектов',
  ];

  return (
    <div className="space-y-4">
      {/* Сканер и счётчики. Пока вещь на экране — поле заблокировано: сначала
          закончи с ней, потом бери следующую. */}
      <div className="space-y-3 rounded-xl border-2 border-violet-300 bg-violet-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xl font-bold text-violet-900">
            {item ? 'Закончите с этой вещью' : 'Отсканируйте вещь'}
          </p>
          <div className="flex gap-2">
            <span className="rounded-lg bg-violet-600 px-4 py-2 text-xl font-bold text-white">
              {waiting} шт. ждёт
            </span>
            {doneCount > 0 && (
              <span className="rounded-lg border border-emerald-400 bg-white px-4 py-2 text-xl font-bold text-emerald-700">
                {doneCount} готово
              </span>
            )}
          </div>
        </div>

        <Input
          ref={inputRef}
          autoFocus
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          onBlur={focusInput}
          placeholder={
            item ? 'Сначала завершите текущую вещь' : 'Поднесите стикер или ярлык к сканеру'
          }
          className="h-16 font-mono-tech text-2xl"
          autoComplete="off"
          disabled={scanning || !!item}
        />

        {!item && (
          <p className="text-base text-violet-800">
            Подойдёт любой код на пакете: наш стикер хранения, ярлык возврата или номер
            отправления
          </p>
        )}

        {scanError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-3">
            <Icon name="TriangleAlert" size={24} className="mt-0.5 shrink-0 text-destructive" />
            <p className="text-lg font-medium text-destructive">{scanError}</p>
          </div>
        )}
      </div>

      {/* Новый пакет? Спрашиваем перед закрытием перепаковки — по этим ответам видно
          реальный расход упаковки на возвратах. Кнопки крупные: экран сенсорный. */}
      <KioskReturnToRollDialog
        open={rollReturnOpen}
        onOpenChange={setRollReturnOpen}
        goodsWarehouseId={item?.id}
      />

      <Dialog open={bagAsk} onOpenChange={(v) => !v && setBagAsk(false)}>
        <DialogContent className="kiosk-root sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl">Вы взяли новый пакет?</DialogTitle>
          </DialogHeader>

          {item && (
            <div className="space-y-4">
              <p className="text-lg text-muted-foreground">
                {item.material && item.width
                  ? `${item.material} ${item.width}×${item.height}`
                  : item.product || 'Товар'}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  size="lg"
                  className="h-24 bg-emerald-600 text-xl text-white hover:bg-emerald-700"
                  onClick={() => handleFinish('repacked', true)}
                  disabled={processing}
                >
                  <Icon name="PackagePlus" size={28} className="mr-2" />
                  Да, новый
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handleFinish('repacked', false)}
                  disabled={processing}
                >
                  <Icon name="Package" size={28} className="mr-2" />
                  Нет, прежний
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Ничего не отсканировано — экран пустой. Список вещей намеренно не выводим:
          упаковщица работает с той вещью, что держит в руках. */}
      {!item ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <Icon name="ScanLine" size={72} className="text-muted-foreground" />
          <p className="text-center text-2xl font-semibold">Отсканируйте вещь из тележки</p>
          <p className="max-w-md text-center text-muted-foreground">
            {waiting > 0
              ? `В цехе ждёт перепаковки ${waiting} шт. Берите вещь и подносите к сканеру`
              : 'Сюда попадают возвраты, которые кладовщик отправил переупаковать'}
          </p>
        </div>
      ) : (
        <Card className="border-2 border-violet-500 shadow-none ring-4 ring-violet-200">
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-2xl font-bold">
                  {item.material && item.width
                    ? `${item.material} ${item.width}×${item.height}`
                    : item.product || 'Товар'}
                </p>
                <p className="break-all font-mono-tech text-sm text-muted-foreground">
                  {item.storageBarcode} · {item.orderNumber || '—'}
                </p>
              </div>
              {item.marketplace && <Badge variant="secondary">{item.marketplace}</Badge>}
            </div>

            {item.returnReason && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Почему вернули:</p>
                <p>{item.returnReason}</p>
              </div>
            )}

            {/* Что с вещью — кнопками: на сенсорном киоске текст не набрать.
                Можно отметить несколько дефектов сразу (дырка + пятно), повторное
                нажатие снимает отметку. */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Что с вещью (обязательно при списании)</p>
              <div className="grid grid-cols-2 gap-2">
                {defects.map((label) => {
                  const chosen = note.split(', ').filter(Boolean);
                  const active = chosen.includes(label);
                  return (
                    <Button
                      key={label}
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      className="h-14 text-base"
                      onClick={() =>
                        setNote(
                          (active ? chosen.filter((c) => c !== label) : [...chosen, label]).join(
                            ', ',
                          ),
                        )
                      }
                    >
                      {active && <Icon name="Check" size={18} className="mr-1.5" />}
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                size="lg"
                className="h-16 bg-emerald-600 text-lg text-white hover:bg-emerald-700"
                onClick={() => setBagAsk(true)}
                disabled={processing}
              >
                <Icon
                  name={processing ? 'Loader2' : 'Check'}
                  size={24}
                  className={`mr-2 ${processing ? 'animate-spin' : ''}`}
                />
                Переупаковано — печать стикера
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-16 text-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleFinish('utilized')}
                disabled={processing}
              >
                <Icon name="Trash2" size={24} className="mr-2" />
                Брак — печать стикера
              </Button>
            </div>

            {/* Перекроила материал и остался годный кусок — вместо утилизации
                возвращаем его на рулон. Метраж пойдёт отдельной строкой и на
                штрафы за недостачу не повлияет. */}
            <Button
              variant="outline"
              className="h-14 w-full border-violet-300 text-base text-violet-700 hover:bg-violet-50 hover:text-violet-800"
              onClick={() => setRollReturnOpen(true)}
              disabled={processing}
            >
              <Icon name="Undo2" size={20} className="mr-2" />
              Вернуть материал на рулон
            </Button>

            {/* Ошиблась вещью — можно вернуть экран к сканеру, ничего не закрывая. */}
            <Button
              variant="ghost"
              className="h-12 w-full text-base"
              onClick={() => {
                setItem(null);
                setNote('');
                focusInput();
              }}
              disabled={processing}
            >
              Это не та вещь — отсканировать другую
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default KioskRepackScreen;
