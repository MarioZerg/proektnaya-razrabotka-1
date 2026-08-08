import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
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
import KioskManualSearch from '@/components/crm/kiosk/KioskManualSearch';

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
  // Ручной поиск заказа — обход сканера, поэтому показываем его только если цех
  // это разрешил в настройках. По умолчанию скрыт: стикеруем строго по QR-коду.
  const [manualSearchAllowed, setManualSearchAllowed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [order]);

  useEffect(() => {
    fetchTerminalSettings(workshopId)
      .then((s) => setManualSearchAllowed(s.manualStickering))
      .catch(() => setManualSearchAllowed(false));
  }, [workshopId]);

  const handleSearch = async () => {
    const value = (inputRef.current?.value || code).trim();
    if (!value) return;
    setCode('');
    if (inputRef.current) inputRef.current.value = '';
    setSearching(true);
    setOrder(null);
    setPrinted(false);
    setTracePrinted(false);
    try {
      const found = await fetchKioskOrder(value);
      playScanSound();
      setOrder(found);
    } catch (e) {
      playScanErrorSound();
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
          printLabelPdf(await fetchOzonLabel(order.orderNumber), 'Ярлык OZON');
        } else if (mp === 'YANDEX') {
          printLabelPdf(await fetchYandexLabel(order.orderNumber), 'Ярлык Яндекс Маркета');
        } else {
          printFboSticker(await fetchOrderDetail(order.id));
        }
      } else {
        // Для стикера нужны штрихкод/код OZON — берём полную карточку заказа.
        printFboSticker(await fetchOrderDetail(order.id));
      }
      setPrinted(true);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать стикер',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleClose = async () => {
    if (!order) return;
    setClosing(true);
    try {
      const res = await closeKioskOrder(order.id, packerId, packerId, packerName);
      playScanSound();
      // Заказ отменён клиентом — вещь едет не покупателю, а на склад хранения. Печатаем
      // стикер ХРАНЕНИЯ: по нему кладовщик заберёт вещь из цеха и положит на полку.
      if (res.isCancelled && res.storageBarcode) {
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title: order.material && order.width
            ? `${order.material} ${order.width}×${order.height}`
            : order.product,
          orderNumber: order.orderNumber,
        });
        toast({
          title: `Заказ ${order.orderNumber} отменён клиентом`,
          description: 'Наклейте стикер хранения — вещь заберёт кладовщик на полку',
        });
        setOrder(null);
        setPrinted(false);
        setTracePrinted(false);
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
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      toast({ title: `Заказ ${order.orderNumber} закрыт`, description: 'Отправлен в «Готовые»' });
      setOrder(null);
      setPrinted(false);
      setTracePrinted(false);
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

  return (
    <div className="space-y-6">
      {!order ? (
        <div className="flex flex-col items-center gap-6 py-10">
          <Icon
            name={searching ? 'Loader2' : 'ScanLine'}
            size={72}
            className={`text-muted-foreground ${searching ? 'animate-spin' : ''}`}
          />
          <p className="text-center text-2xl font-semibold">
            {searching ? 'Ищем заказ…' : 'Отсканируйте QR-код с листка закройщика'}
          </p>
          <p className="text-center text-muted-foreground">
            Сканируются только заказы на стикеровке
          </p>
          {/* Запасной путь, если сканер сломался или QR затёрт: найти заказ по размеру.
              Включается настройкой цеха «Ручной поиск заказа на терминале». */}
          {manualSearchAllowed && (
            <div className="w-full max-w-md">
              <KioskManualSearch
                workshopId={workshopId}
                role={role}
                onSelect={(found) => {
                  setOrder(found);
                  setPrinted(false);
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <Card className="border-border shadow-none">
          <CardContent className="space-y-4 pt-6">
            {/* Заказ Яндекса из нескольких вещей отгружается по одному общему ярлыку —
                упаковщица должна дождаться все вещи и упаковать их вместе. */}
            {/* Покупатель — компания. Шьётся и упаковывается как обычно, но
                упаковщица должна видеть, кому уйдёт вещь. */}
            {order.isLegalEntity && (
              <div className="flex items-start gap-3 rounded-md border border-indigo-300 bg-indigo-50 p-3 text-indigo-900">
                <Icon name="Building2" size={22} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">Заказ юридического лица</p>
                  <p className="text-sm">
                    {order.legalCompanyName || 'Покупатель — компания'}. Собирается как обычный
                    заказ, ярлык отправления печатается так же
                  </p>
                </div>
              </div>
            )}
            {order.groupSize && order.groupSize > 1 && (
              <div className="flex items-start gap-3 rounded-md border border-violet-300 bg-violet-50 p-3 text-violet-900">
                <Icon name="Package" size={22} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">
                    Заказ из {order.groupSize} вещей — это {order.groupPosition}-я
                  </p>
                  <p className="text-sm">
                    Каждая вещь едет своим пакетом со своим ярлыком. Отгружается заказ только
                    целиком — все {order.groupSize} вещи должны попасть в одну поставку
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2 text-lg">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Заказ</span>
                <span className="font-mono-tech font-bold">{order.orderNumber}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Товар</span>
                <span className="font-semibold">{order.product}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Материал</span>
                <span className="font-semibold">{order.material || '—'}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Размер</span>
                <span className="font-semibold">
                  {order.width && order.height ? `${order.width}×${order.height}` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Маркетплейс</span>
                <span className="font-semibold">
                  {order.marketplace || 'Индивидуальный'}
                  {order.orderType && order.orderType !== 'Индивидуальный' && (
                    <Badge variant="secondary" className="ml-2">
                      {order.orderType}
                    </Badge>
                  )}
                </span>
              </div>
              {/* Кластер FBO — город, куда уедет поставка. Нужен, чтобы не смешать
                  вещи из разных поставок в одну коробку. */}
              {order.orderType === 'FBO' && order.cluster && (
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Город назначения</span>
                  <span className="font-semibold">{order.cluster}</span>
                </div>
              )}
              {/* Вещь из связки: показываем, какая она по счёту в заказе покупателя. */}
              {order.groupSize && order.groupSize > 1 && (
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Связка</span>
                  <span className="font-semibold">
                    {order.groupPosition} из {order.groupSize}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Закройщик</span>
                <span className="font-semibold">{order.cutterName || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Швея</span>
                <span className="font-semibold">
                  {order.sewerName || order.assignedUserName || '—'}
                </span>
              </div>
            </div>

            <Button
              size="lg"
              variant={tracePrinted ? 'outline' : 'default'}
              className="h-16 w-full text-lg"
              onClick={() => {
                printTraceSticker(order);
                setTracePrinted(true);
              }}
            >
              <Icon name={tracePrinted ? 'Check' : 'QrCode'} size={24} className="mr-2" />
              {tracePrinted ? 'Стикер в пакет напечатан' : 'Стикер в пакет (кто шил)'}
            </Button>

            {order.isCancelled ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center">
                <p className="text-lg font-bold text-destructive">Клиент отменил заказ</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Стикер отправления не нужен. Нажмите «Закрыть заказ» — распечатается стикер
                  хранения, наклейте его и оставьте вещь для кладовщика
                </p>
              </div>
            ) : (
              <Button size="lg" className="h-16 w-full text-lg" onClick={handlePrint}>
                <Icon name="Printer" size={24} className="mr-2" />
                {order.orderType === 'FBS'
                  ? 'Распечатать ярлык отправления'
                  : 'Распечатать стикер'}
              </Button>
            )}

            {(printed || order.isCancelled) && (
              <Button
                size="lg"
                className="h-16 w-full bg-emerald-600 text-lg text-white hover:bg-emerald-700"
                onClick={handleClose}
                disabled={closing}
              >
                <Icon
                  name={closing ? 'Loader2' : 'Check'}
                  size={24}
                  className={`mr-2 ${closing ? 'animate-spin' : ''}`}
                />
                Закрыть заказ
              </Button>
            )}

            <Button
              variant="outline"
              size="lg"
              className="h-14 w-full"
              onClick={() => {
                setOrder(null);
                setPrinted(false);
                setTracePrinted(false);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              Отмена
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Скрытое поле — сканер печатает в него незаметно для сотрудника. */}
      <input
        ref={inputRef}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
        className="pointer-events-none absolute h-px w-px border-0 p-0 opacity-0"
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};

export default KioskOrdersScreen;