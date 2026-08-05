import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchKioskOrder, closeKioskOrder, type KioskOrder } from '@/lib/kioskApi';
import { fetchOrderDetail } from '@/lib/ordersApi';
import { printFboSticker } from '@/lib/printFboSticker';
import { printBarcodes } from '@/lib/printBarcodes';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

interface KioskOrdersScreenProps {
  packerId: number;
  packerName: string;
}

/** Экран печати заказов: сотрудник сканирует QR с листка закройщика, видит данные товара,
 * печатает стикер и закрывает заказ. Сканируются только заказы на стикеровке — это
 * проверяет сервер. */
const KioskOrdersScreen = ({ packerId, packerName }: KioskOrdersScreenProps) => {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<KioskOrder | null>(null);
  const [printed, setPrinted] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [order]);

  const handleSearch = async () => {
    const value = (inputRef.current?.value || code).trim();
    if (!value) return;
    setCode('');
    if (inputRef.current) inputRef.current.value = '';
    setSearching(true);
    setOrder(null);
    setPrinted(false);
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
      // Для стикера нужны штрихкод/код OZON — берём полную карточку заказа.
      const detail = await fetchOrderDetail(order.id);
      printFboSticker(detail);
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
        printBarcodes(
          [{ code: res.storageBarcode, label: `${order.orderNumber} — ${order.product}` }],
          `Стикер хранения ${res.storageBarcode}`,
        );
        toast({
          title: `Заказ ${order.orderNumber} отменён клиентом`,
          description: 'Наклейте стикер хранения — вещь заберёт кладовщик на полку',
        });
        setOrder(null);
        setPrinted(false);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      toast({ title: `Заказ ${order.orderNumber} закрыт`, description: 'Отправлен в «Готовые»' });
      setOrder(null);
      setPrinted(false);
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
        </div>
      ) : (
        <Card className="border-border shadow-none">
          <CardContent className="space-y-4 pt-6">
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
                <span className="text-muted-foreground">Материал / размер</span>
                <span className="font-semibold">
                  {order.material} {order.width}×{order.height}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Швея</span>
                <span className="font-semibold">{order.assignedUserName || '—'}</span>
              </div>
            </div>

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
                Распечатать стикер
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