import { useRef, useState } from 'react';
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

  const handlePrintStickers = () => {
    const win = window.open('', '_blank');
    if (!win) {
      toast({ title: 'Разрешите всплывающие окна для печати', variant: 'destructive' });
      return;
    }
    const title = `Стикеры коробов — поставка ${supply.wbSupplyId || supply.supplyNumber || supplyId}`;
    const pages = boxStickers
      .map(
        (s) => `<div class="page">
          ${s.label ? `<div class="label">Короб ${s.label}</div>` : ''}
          <img src="${s.url}" alt="Стикер короба" />
        </div>`
      )
      .join('');
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; }
        .page { display: flex; flex-direction: column; align-items: center; justify-content: center;
                min-height: 100vh; page-break-after: always; padding: 16px; }
        .label { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
        img { max-width: 100%; max-height: 90vh; object-fit: contain; }
        @media print { .page { min-height: auto; height: 100vh; } }
      </style></head><body onload="window.print()">${pages}</body></html>`
    );
    win.document.close();
  };

  useScannerAutoSubmit(scanValue, handleScan, !scanning && canScan);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-sm">
          {/* Сколько вещей упаковщицы уже отстикеровали и сложили в контейнер:
              по этому числу кладовщик решает, идти ли на производство. */}
          <span>
            Готово к сборке: <b>{supply.wbReadyCount}</b>
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
              Создайте поставку на стороне WildBerries — после этого можно сканировать готовые заказы в неё.
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

      <h3 className="pt-2 text-sm font-semibold">В поставке ({supply.wbOrders.length})</h3>
      {supply.wbOrders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Заказов в поставке пока нет</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">Заказ</TableHead>
                <TableHead className="text-primary-foreground">Товар</TableHead>
                <TableHead className="text-primary-foreground">Короб WB</TableHead>
                <TableHead className="text-primary-foreground">Стикер короба</TableHead>
                {canRemove && <TableHead className="text-primary-foreground"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {supply.wbOrders.map((o) => (
                <TableRow key={o.id} className={o.isCancelled ? 'bg-destructive/5' : undefined}>
                  <TableCell className="font-medium">
                    {o.orderNumber}
                    {o.isCancelled && (
                      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                        отменён
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{o.product || '—'}</TableCell>
                  <TableCell className="font-mono-tech">{o.wbTrbxId || '—'}</TableCell>
                  <TableCell>
                    {o.stickerUrl ? (
                      <a
                        href={o.stickerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Icon name="QrCode" size={16} />
                        Открыть
                      </a>
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
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default WbFbsSupplyCard;