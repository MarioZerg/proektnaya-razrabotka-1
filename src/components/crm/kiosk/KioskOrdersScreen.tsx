import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { recoverIfStaleBuild } from '@/lib/appUpdate';
import {
  SpareItemError,
  storeSpareItem,
  fetchKioskOrder,
  closeKioskOrder,
  fetchTerminalSettings,
  type KioskOrder,
} from '@/lib/kioskApi';
import { fetchOrderDetail } from '@/lib/ordersApi';
import { printFboSticker } from '@/lib/printFboSticker';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import { printLabelPng, printLabelPdf } from '@/lib/printMarketplaceLabel';
import { fetchWbLabel } from '@/lib/wbFbsApi';
import { fetchOzonLabel } from '@/lib/ozonFbsApi';
import { fetchYandexLabel } from '@/lib/yandexMarketApi';
import { printTraceSticker } from '@/lib/printTraceSticker';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';
import KioskScanPrompt from '@/components/crm/kiosk/KioskScanPrompt';
import KioskOrderNotices from '@/components/crm/kiosk/KioskOrderNotices';
import KioskOrderDetails from '@/components/crm/kiosk/KioskOrderDetails';
import KioskOrderActions from '@/components/crm/kiosk/KioskOrderActions';

interface KioskOrdersScreenProps {
  packerId: number;
  packerName: string;
  workshopId?: number | null;
  role?: string | null;
}

/** Экран печати заказов: сотрудник сканирует QR с листка закройщика, видит данные товара,
 * печатает стикер и закрывает заказ. Сканируются только заказы на стикеровке — это
 * проверяет сервер. */
const KioskOrdersScreen = ({ packerId, packerName, workshopId, role }: KioskOrdersScreenProps) => {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<KioskOrder | null>(null);
  const [printed, setPrinted] = useState(false);
  // Внутренний стикер с номером нашего заказа кладётся ВНУТРЬ пакета. По нему при возврате
  // видно, кто шил именно эту штуку — на FBO маркетплейс такой информации не даёт.
  const [tracePrinted, setTracePrinted] = useState(false);
  const [closing, setClosing] = useState(false);
  // Маркетплейс ТОЧНО отказал в ярлыке (а не просто «отправление помечено уехавшим»).
  // Только после реальной попытки печати вещь уходит на хранение: раньше терминал решал
  // это заранее по статусу, и вещи многовещевых посылок нельзя было доложить в свою же
  // посылку, хотя ярлык на неё ещё выдавался.
  const [labelRefused, setLabelRefused] = useState(false);
  // Вещь по УЖЕ ЗАКРЫТОМУ заказу, оставшаяся на руках у упаковщицы: заказ закрыли вещью
  // с полки, а швея дошила свою. Покупателю она не поедет, но это готовый товар —
  // предлагаем сдать его на склад как свободный остаток, а не бросать в цехе.
  const [spare, setSpare] = useState<SpareItemError['order'] | null>(null);
  const [storingSpare, setStoringSpare] = useState(false);
  // Ручной поиск заказа — обход сканера, поэтому показываем его только если цех
  // это разрешил в настройках. По умолчанию скрыт: стикеруем строго по QR-коду.
  const [manualSearchAllowed, setManualSearchAllowed] = useState(false);
  // Попытка отсканировать новый заказ, не закрыв текущий: показываем крупное
  // предупреждение прямо на экране, а не только всплывашкой — её легко не заметить.
  const [blockedWarning, setBlockedWarning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [order]);

  // Админу и старшему кладовщику ручной поиск доступен всегда, независимо от настройки
  // цеха: они подходят к терминалу именно тогда, когда обычный путь не сработал —
  // сканер не берёт стикер или вещь «зависла», и разобраться надо на месте.
  const privilegedSearch = role === 'admin' || role === 'senior_storekeeper';

  useEffect(() => {
    if (privilegedSearch) {
      setManualSearchAllowed(true);
      return;
    }
    fetchTerminalSettings(workshopId)
      .then((s) => setManualSearchAllowed(s.manualStickering))
      .catch(() => setManualSearchAllowed(false));
  }, [workshopId, privilegedSearch]);

  const handleSearch = async () => {
    const value = (inputRef.current?.value || code).trim();
    if (!value) return;
    setCode('');
    if (inputRef.current) inputRef.current.value = '';
    setSearching(true);
    setOrder(null);
    setPrinted(false);
    setTracePrinted(false);
    setLabelRefused(false);
    setSpare(null);
    setBlockedWarning(false);
    try {
      const found = await fetchKioskOrder(value);
      playScanSound();
      setOrder(found);
    } catch (e) {
      playScanErrorSound();
      // Заказ закрыт, но вещь у упаковщицы в руках — показываем, как её сдать на склад.
      if (e instanceof SpareItemError) {
        setSpare(e.order);
        toast({ title: 'Заказ уже закрыт', description: e.message });
        return;
      }
      toast({
        title: 'Заказ не найден',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSearching(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  useScannerAutoSubmit(code, handleSearch, !searching && !order, 400);

  // Подстраховка на случай, если скрытое поле потеряло фокус (всплывающее окно, касание
  // экрана, возврат планшета из сна). Тогда сканер печатает «мимо» поля, и терминал
  // молчит на скан. Здесь ловим ввод сканера на уровне страницы и ищем заказ так же,
  // как при обычном сканировании.
  useGlobalScanner(
    (scanned) => {
      if (inputRef.current) inputRef.current.value = scanned;
      handleSearch();
    },
    !searching && !order,
  );

  // Стикер напечатан, но заказ НЕ закрыт — работа не доделана.
  //
  // Упаковщица наклеила ярлык, положила вещь в пакет и потянулась за следующей: скан
  // нового кода при этом просто не срабатывал, терминал молчал. Она сканировала ещё
  // раз, ещё — и в итоге уходила, бросив незакрытый заказ. Такой заказ навсегда висит
  // в стикеровке: зарплата за него не начислена, вещь числится несобранной, а на
  // складе её уже нет.
  //
  // Теперь на скан отвечаем громко: звук ошибки и большое предупреждение. Новый заказ
  // не ищем, пока текущий не закрыт.
  const unfinished = !!order && printed && !closing;

  useGlobalScanner(() => {
    playScanErrorSound();
    setBlockedWarning(true);
    toast({
      title: 'Сначала закройте текущий заказ',
      description: 'Стикер напечатан, но заказ не завершён — нажмите «Закрыть заказ»',
      variant: 'destructive',
    });
  }, unfinished);

  const handlePrint = async () => {
    if (!order) return;
    try {
      // FBS: ярлык отправления печатает МАРКЕТПЛЕЙС — берём готовый файл по API и печатаем
      // как есть. Свой аналог рисовать нельзя: на складе принимают только их ярлык с их
      // кодами. FBO: маркетплейсного ярлыка нет, печатаем свой стикер товара.
      if (order.orderType === 'FBS') {
        const mp = (order.marketplace || '').toUpperCase();
        if (mp === 'WB') {
          printLabelPng(await fetchWbLabel(order.orderNumber), 'Стикер WB');
        } else if (mp === 'OZON') {
          await printLabelPdf(await fetchOzonLabel(order.orderNumber), 'Ярлык OZON');
        } else if (mp === 'YANDEX') {
          await printLabelPdf(await fetchYandexLabel(order.orderNumber), 'Ярлык Яндекс Маркета');
        } else {
          printFboSticker(await fetchOrderDetail(order.id));
        }
      } else {
        // Для стикера нужны штрихкод/код OZON — берём полную карточку заказа.
        printFboSticker(await fetchOrderDetail(order.id));
      }
      setPrinted(true);
    } catch (e) {
      // Терминал открыт со старой версии, а её файлы на сервере уже заменены —
      // подгрузка кода печати падает. Забираем свежую версию сами: сотруднику
      // незачем разбираться в английских ошибках браузера.
      if (recoverIfStaleBuild(e)) {
        toast({ title: 'Обновляем систему…', description: 'Через миг повторите печать' });
        return;
      }
      // Маркетплейс отказал в ярлыке, потому что отправление уже уехало. Показываем
      // это как ситуацию, а не как сбой печати, и сразу открываем «Закрыть заказ»:
      // иначе вещь остаётся в цехе, а заказ навсегда висит в очереди стикеровки.
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('Ярлык не нужен')) {
        setOrder((prev) => (prev ? { ...prev, labelGone: true } : prev));
        setLabelRefused(true);
        toast({ title: 'Ярлык не нужен', description: msg });
        return;
      }
      toast({
        title: 'Не удалось напечатать стикер',
        description: msg || undefined,
        variant: 'destructive',
      });
    }
  };

  const handleClose = async () => {
    if (!order) return;
    setClosing(true);
    try {
      const res = await closeKioskOrder(
        order.id,
        packerId,
        packerId,
        packerName,
        // Ярлык напечатан и маркетплейс не отказал — вещь едет покупателю, а не на полку.
        printed && !labelRefused,
      );
      playScanSound();
      // Заказ отменён клиентом — вещь едет не покупателю, а на склад хранения. Печатаем
      // стикер ХРАНЕНИЯ: по нему кладовщик заберёт вещь из цеха и положит на полку.
      if (res.isCancelled && res.storageBarcode) {
        // Связка Яндекса: вещи заказа едут на склад по отдельности, но на полке их
        // нужно держать вместе. Пишем прямо на наклейке, что вещь из связки и какая
        // по счёту, — иначе одинаковые стикеры на полке не различить.
        const groupLabel =
          order.groupKey && (order.groupSize || 0) > 1
            ? `Связка ${order.groupPosition || 1} из ${order.groupSize}`
            : null;
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title: order.material && order.width
            ? `${order.material} ${order.width}×${order.height}`
            : order.product,
          orderNumber: order.orderNumber,
          groupLabel,
        });
        toast({
          title: `Заказ ${order.orderNumber} отменён клиентом`,
          description: groupLabel
            ? `${groupLabel}. Наклейте стикер хранения и держите вещи связки вместе`
            : 'Наклейте стикер хранения — вещь заберёт кладовщик на полку',
        });
        setOrder(null);
        setPrinted(false);
        setTracePrinted(false);
        setBlockedWarning(false);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      // Индивидуальный пошив на маркетплейс не едет: вещь до выдачи клиенту лежит
      // на полке. Печатаем свой стикер — с тканью, размерами и складским штрихкодом.
      if (res.isIndividual && res.storageBarcode) {
        printIndividualSticker({
          orderNumber: res.orderNumber || order.orderNumber,
          material: res.material ?? order.material,
          width: res.width ?? order.width,
          height: res.height ?? order.height,
          storageBarcode: res.storageBarcode,
          product: res.product ?? order.product,
        });
        toast({
          title: `Заказ ${order.orderNumber} закрыт`,
          description: 'Наклейте стикер и передайте вещь на полку хранения',
        });
        setOrder(null);
        setPrinted(false);
        setTracePrinted(false);
        setBlockedWarning(false);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      // Связка Яндекса: каждая вещь стикеруется своим ярлыком по очереди. Говорим
      // упаковщице, сколько вещей заказа ещё не готово, — чтобы она не унесла пакет
      // и не отправила связку по частям. Когда осталось ноль, связка собрана целиком.
      if (res.groupSize && res.groupSize > 1) {
        const left = res.groupLeft ?? 0;
        toast({
          title:
            left > 0
              ? `Вещь ${res.groupPosition} из ${res.groupSize} застикерована`
              : `Связка собрана полностью: ${res.groupSize} вещи`,
          description:
            left > 0
              ? `Осталось застикеровать ещё ${left} — не уносите пакет, заказ уезжает целиком`
              : 'Все вещи заказа готовы — можно отправлять',
        });
      } else {
        toast({
          title: res.alreadyClosed
            ? `Заказ ${order.orderNumber} уже был закрыт`
            : `Заказ ${order.orderNumber} закрыт`,
          description: res.alreadyClosed
            ? 'Работа по нему уже принята — стикеровать заново не нужно'
            : 'Отправлен в «Готовые»',
        });
      }
      setOrder(null);
      setPrinted(false);
      setTracePrinted(false);
      setBlockedWarning(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setClosing(false);
    }
  };

  // Сдать лишнюю вещь на склад: печатаем стикер хранения и отдаём кладовщику.
  const handleStoreSpare = async () => {
    if (!spare) return;
    setStoringSpare(true);
    try {
      const res = await storeSpareItem(spare.id, packerId, packerName);
      printStorageSticker({
        storageBarcode: res.storageBarcode,
        title: [res.material, res.width && res.height ? `${res.width}x${res.height}` : null]
          .filter(Boolean)
          .join(' '),
        orderNumber: res.orderNumber,
      });
      toast({
        title: 'Вещь принята на склад',
        description: 'Наклейте стикер хранения и передайте вещь кладовщику',
      });
      setSpare(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      toast({
        title: 'Не удалось сдать вещь',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setStoringSpare(false);
    }
  };

  return (
    <div className="space-y-6">
      {spare && !order && (
        <Card className="border-amber-300 bg-amber-50 shadow-none">
          <CardContent className="space-y-3 pt-6 text-center">
            <p className="text-lg font-bold text-amber-900">Заказ уже закрыт</p>
            <p className="text-sm text-amber-900">
              Заказ {spare.orderNumber} закрыли вещью со склада, покупателю эта вещь уже не
              поедет. Сдайте её на склад — она пойдёт на следующий такой же заказ
            </p>
            <p className="text-sm font-semibold text-amber-900">
              {spare.material} {spare.width}×{spare.height}
            </p>
            <Button
              size="lg"
              className="h-16 w-full bg-amber-600 text-lg text-white hover:bg-amber-700"
              onClick={handleStoreSpare}
              disabled={storingSpare}
            >
              <Icon
                name={storingSpare ? 'Loader2' : 'PackagePlus'}
                size={24}
                className={`mr-2 ${storingSpare ? 'animate-spin' : ''}`}
              />
              Сдать на склад со стикером хранения
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-14 w-full"
              onClick={() => {
                setSpare(null);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Отмена
            </Button>
          </CardContent>
        </Card>
      )}

      {!order ? (
        <KioskScanPrompt
          searching={searching}
          manualSearchAllowed={manualSearchAllowed}
          workshopId={workshopId}
          role={role}
          onSelect={(found) => {
            setOrder(found);
            setPrinted(false);
          }}
        />
      ) : (
        <Card className="border-border shadow-none">
          <CardContent className="space-y-4 pt-6">
            {/* Попытались взять новый заказ, не закрыв текущий. Пишем крупно и
                красным: упаковщица смотрит на экран издалека и всплывашку внизу
                не видит — она уже тянется за следующей вещью. */}
            {blockedWarning && (
              <div className="rounded-md border-2 border-destructive bg-destructive/10 p-4 text-center">
                <p className="text-xl font-bold text-destructive">
                  Завершите текущий заказ
                </p>
                <p className="mt-1 text-base text-muted-foreground">
                  Стикер напечатан, но заказ не закрыт. Нажмите «Закрыть заказ» —
                  и только потом сканируйте следующий
                </p>
              </div>
            )}
            <KioskOrderNotices order={order} />
            <KioskOrderDetails order={order} />
            <KioskOrderActions
              order={order}
              printed={printed}
              labelRefused={labelRefused}
              tracePrinted={tracePrinted}
              closing={closing}
              onPrintTrace={() => {
                printTraceSticker(order);
                setTracePrinted(true);
              }}
              onPrint={handlePrint}
              onClose={handleClose}
              // Бросить заказ можно, только пока ярлык НЕ напечатан. После печати
              // вещь уже помечена и физически ушла в пакет — заказ обязан быть
              // закрыт, иначе он навсегда зависнет в стикеровке без начисления.
              cancelBlocked={unfinished}
              onCancel={() => {
                if (unfinished) {
                  playScanErrorSound();
                  setBlockedWarning(true);
                  return;
                }
                setOrder(null);
                setPrinted(false);
                setTracePrinted(false);
                setBlockedWarning(false);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Скрытое поле — сканер печатает в него незаметно для сотрудника. */}
      <input
        ref={inputRef}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          // Скан пришёл в скрытое поле, а текущий заказ ещё не закрыт — новый
          // не ищем. Это основной путь сканера, поэтому предупреждение должно
          // сработать и здесь, а не только у глобального перехватчика.
          if (unfinished) {
            setCode('');
            if (inputRef.current) inputRef.current.value = '';
            playScanErrorSound();
            setBlockedWarning(true);
            return;
          }
          handleSearch();
        }}
        onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
        className="pointer-events-none absolute h-px w-px border-0 p-0 opacity-0"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};

export default KioskOrdersScreen;