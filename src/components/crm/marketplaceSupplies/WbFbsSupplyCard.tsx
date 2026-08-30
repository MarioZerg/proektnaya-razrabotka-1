import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import printHtmlInIframe from '@/lib/printInIframe';
import { printLabelFromUrl } from '@/lib/printMarketplaceLabel';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import {
  createWbSupply,
  scanWbOrderToSupply,
  deliverWbSupply,
  removeWbOrderFromSupply,
  shelfCancelledOrder,
} from '@/lib/wbFbsApi';

interface WbFbsSupplyCardProps {
  supply: SupplyDetail;
  supplyId: number;
  onReload: () => void;
}

/** Карточка сборки WB FBS-поставки: создание поставки на стороне WildBerries, сканирование
 * готовых заказов в поставку (со счётчиками готово/отсканировано), передача в доставку и
 * отображение стикеров коробов, которые WB возвращает при закрытии. */
const WbFbsSupplyCard = ({ supply, supplyId, onReload }: WbFbsSupplyCardProps) => {
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
  const wbAwaiting = (supply.wbAwaitingItems || []).filter(
    (a) => !a.orderNumber || !scannedOrders.has(a.orderNumber),
  );
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
      toast({
        title: `Заказ ${orderNumber} убран из поставки`,
        description: `Наклейте стикер хранения ${r.storageBarcode} — вещь едет на полку`,
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
    const orderNumber = scanValue.trim();
    if (!orderNumber) return;
    setScanValue('');
    setScanning(true);
    try {
      await scanWbOrderToSupply(supplyId, orderNumber);
      playScanSound();
      toast({ title: `Заказ ${orderNumber} добавлен в поставку` });
      onReload();
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

  // Уникальные стикеры коробов (один trbx-стикер может относиться к нескольким заказам).
  const boxStickers = Array.from(
    new Map(
      supply.wbOrders
        .filter((o) => o.stickerUrl)
        .map((o) => [o.wbTrbxId || o.stickerUrl!, { url: o.stickerUrl!, label: o.wbTrbxId || '' }])
    ).values()
  );

  /**
   * Печать стикеров коробов WB на этикеточном принтере 58×40 мм.
   *
   * Раньше страница печати открывалась во всплывающем окне без указания размера листа:
   * браузер брал A4 и книжную ориентацию, а в настройках принтера размер уже не менялся —
   * кладовщик получал стикер на четверть листа. Теперь лист жёстко задан как 58×40, поля
   * нулевые, а картинка растягивается на всю наклейку, и принтер печатает как надо.
   *
   * Печатаем через скрытый iframe, а не новым окном: всплывающие окна блокирует браузер,
   * и на терминале склада кладовщик просто не видел диалога печати.
   */
  const handlePrintStickers = () => {
    if (!boxStickers.length) return;
    const pages = boxStickers
      .map((s) => `<div class="label"><img src="${s.url}" alt="Стикер короба" /></div>`)
      .join('');
    printHtmlInIframe(
      `<!doctype html><html><head><meta charset="utf-8"><title>Стикеры коробов WB</title>
      <style>
        @page { size: 58mm 40mm; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 58mm; }
        body { font-family: Arial, Helvetica, sans-serif; }
        .label {
          width: 58mm; height: 40mm;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          /* Каждый стикер — свой лист: рулонный принтер отрежет по границе наклейки. */
          page-break-after: always;
          break-after: page;
        }
        .label:last-child { page-break-after: auto; break-after: auto; }
        /* Картинка от WB уже в пропорции наклейки — вписываем её целиком, без обрезки. */
        .label img { max-width: 58mm; max-height: 40mm; width: auto; height: auto; }
      </style></head><body>${pages}</body></html>`,
    );
  };

  useScannerAutoSubmit(scanValue, handleScan, !scanning && canScan);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-sm">
          {/* Сколько заказов лежит в резервной поставке на WB: туда упаковщицы
              переносят всё, что застикеровали на конвейере. Это и есть объём работы —
              столько кладовщику предстоит отсканировать в свою поставку.
              Не успел забрать всё — остаток так и останется в резерве и попадёт
              в счётчик следующей поставки, как только он её создаст. */}
          <span>
            Ожидают отгрузки: <b>{supply.wbReadyCount}</b>
          </span>
          <span>
            Отсканировано в поставку: <b>{supply.wbOrders.length}</b>
          </span>
          {supply.wbSupplyId && (
            <span className="text-muted-foreground">
              WB: <b className="font-mono-tech">{supply.wbSupplyId}</b>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {boxStickers.length > 0 && (
            <Button variant="outline" onClick={handlePrintStickers}>
              <Icon name="Printer" size={16} className="mr-1.5" />
              Печать всех стикеров ({boxStickers.length})
            </Button>
          )}
          {canDeliver && (
            <Button onClick={handleDeliver} disabled={delivering} className="bg-emerald-600 hover:bg-emerald-700">
              <Icon name={delivering ? 'Loader2' : 'Truck'} size={16} className={`mr-1.5 ${delivering ? 'animate-spin' : ''}`} />
              Отправить в доставку
            </Button>
          )}
        </div>
      </div>

      {!wbCreated && (
        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="text-sm text-muted-foreground">
              {creatingSupply
                ? 'Создаём поставку на WildBerries — сканер откроется автоматически'
                : 'Не удалось создать поставку на WildBerries. Нажмите, чтобы повторить.'}
            </div>
            <Button onClick={handleCreateSupply} disabled={creatingSupply}>
              <Icon name={creatingSupply ? 'Loader2' : 'PackagePlus'} size={16} className={`mr-1.5 ${creatingSupply ? 'animate-spin' : ''}`} />
              Создать поставку на WB
            </Button>
          </CardContent>
        </Card>
      )}

      {canScan && (
        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent
            className="space-y-2 pt-6"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('input, button, a')) scanRef.current?.focus();
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon name="ScanLine" size={18} />
              Сканируйте пакет с товаром — стикер заказа WB FBS (номер заказа)
            </div>
            <div className="flex gap-2">
              <Input
                ref={scanRef}
                autoFocus
                placeholder="Номер заказа WB"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                disabled={scanning}
                className="font-mono-tech"
              />
              <Button onClick={handleScan} disabled={scanning || !scanValue.trim()}>
                {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Чек-лист сборки: сверху зелёным то, что уже отсканировано, ниже — что ещё
          лежит в резерве и ждёт кладовщика. Пикнул ярлык — строка позеленела. */}
      <h3 className="pt-2 text-sm font-semibold">
        Собрано {supply.wbOrders.length} из {supply.wbOrders.length + wbAwaiting.length}
      </h3>
      {supply.wbOrders.length === 0 && wbAwaiting.length === 0 ? (
        <p className="text-sm text-muted-foreground">Заказов в поставке пока нет</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="w-10 text-primary-foreground"></TableHead>
                <TableHead className="text-primary-foreground">Заказ</TableHead>
                <TableHead className="text-primary-foreground">Товар</TableHead>
                <TableHead className="text-primary-foreground">Материал</TableHead>
                <TableHead className="text-primary-foreground">Размер</TableHead>
                <TableHead className="text-primary-foreground">Стикеровал</TableHead>
                <TableHead className="text-primary-foreground">Короб WB</TableHead>
                <TableHead className="text-primary-foreground">Стикер короба</TableHead>
                {canRemove && <TableHead className="text-primary-foreground"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {supply.wbOrders.map((o) => (
                <TableRow
                  key={o.id}
                  className={o.isCancelled ? 'bg-destructive/5' : 'bg-emerald-50 hover:bg-emerald-100'}
                >
                  <TableCell>
                    <Icon
                      name="CircleCheck"
                      size={18}
                      className={o.isCancelled ? 'text-destructive' : 'text-emerald-600'}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {o.orderNumber}
                    {o.isCancelled && (
                      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                        отменён
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{o.product || '—'}</TableCell>
                  <TableCell>{o.material || '—'}</TableCell>
                  <TableCell>
                    {o.width && o.height ? `${o.width}×${o.height}` : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{o.labeledByName || '—'}</TableCell>
                  <TableCell className="font-mono-tech">{o.wbTrbxId || '—'}</TableCell>
                  <TableCell>
                    {o.stickerUrl ? (
                      // Печать на наклейке 58×40. Открытие ссылкой оставляем рядом:
                      // из просмотрщика браузера стикер печатался на A4 с полями.
                      <button
                        type="button"
                        onClick={() =>
                          printLabelFromUrl(o.stickerUrl!, 'Стикер короба WB')
                        }
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Icon name="Printer" size={16} />
                        Печать
                      </button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  {canRemove && (
                    <TableCell className="whitespace-nowrap">
                      {/* Отменённый заказ везти нельзя: кладовщик убирает его прямо
                          отсюда — вещь уходит на полку, а с WB задание снимается. */}
                      {o.isCancelled && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mr-1"
                          onClick={() => handleShelf(o.orderId, o.orderNumber)}
                          disabled={shelvingId === o.orderId}
                          title="Убрать из поставки и положить на полку"
                        >
                          <Icon
                            name={shelvingId === o.orderId ? 'Loader2' : 'PackageOpen'}
                            size={14}
                            className={`mr-1 ${shelvingId === o.orderId ? 'animate-spin' : ''}`}
                          />
                          На полку
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemove(o.orderId, o.orderNumber)}
                        disabled={removingId === o.orderId}
                        title="Убрать заказ из поставки"
                      >
                        <Icon name={removingId === o.orderId ? 'Loader2' : 'Trash2'} size={14} className={removingId === o.orderId ? 'animate-spin' : ''} />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}

              {/* Ещё не отсканированные: лежат в резервной поставке WB и ждут, когда
                  кладовщик принесёт их и пикнет ярлык. */}
              {wbAwaiting.map((a) => (
                <TableRow key={`wait-${a.id}`} className="hover:bg-muted/60">
                  <TableCell>
                    <Icon name="Circle" size={18} className="text-muted-foreground/40" />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="break-all">{a.orderNumber || '—'}</span>
                    {a.shelfName && (
                      <div className="text-xs text-muted-foreground">Полка «{a.shelfName}»</div>
                    )}
                  </TableCell>
                  <TableCell>{a.product || '—'}</TableCell>
                  <TableCell>{a.material || '—'}</TableCell>
                  <TableCell>
                    {a.width && a.height ? `${a.width}×${a.height}` : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{a.labeledByName || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">—</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    Ждёт сканирования
                  </TableCell>
                  {canRemove && <TableCell />}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default WbFbsSupplyCard;