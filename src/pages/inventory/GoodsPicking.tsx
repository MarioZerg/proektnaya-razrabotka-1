import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
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
import {
  fetchGoodsWarehouse,
  startPicking,
  cancelPicking,
  rematchStock,
  type GoodsWarehouseItem,
} from '@/lib/goodsWarehouseApi';
import ShipLabelDialog from '@/components/crm/goodsWarehouse/ShipLabelDialog';
import SendToSewingDialog from '@/components/crm/goodsWarehouse/SendToSewingDialog';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

const GoodsPicking = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [inStock, setInStock] = useState<GoodsWarehouseItem[]>([]);
  const [picking, setPicking] = useState<GoodsWarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const [shipLabelOpen, setShipLabelOpen] = useState(false);
  const [rematching, setRematching] = useState(false);
  // Вещь, которую отправляем в пошив (испорчена): открывает окно с причиной.
  const [sewingItem, setSewingItem] = useState<GoodsWarehouseItem | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchGoodsWarehouse('in_stock'), fetchGoodsWarehouse('picking')])
      .then(([stockData, pickingData]) => {
        setInStock(stockData);
        setPicking(pickingData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Подбор срабатывает и во время работы цеха (швея дошила вещь → она легла на полку),
    // поэтому список обновляем сами — кладовщику не нужно жать F5.
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRematch = async () => {
    setRematching(true);
    try {
      const res = await rematchStock();
      toast({
        title: res.matched
          ? `Подобрано заказов со склада: ${res.matched}`
          : 'Новых совпадений нет — всё уже подобрано',
      });
      load();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRematching(false);
    }
  };

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code) return;
    setScanCode('');
    setScanning(true);
    try {
      await startPicking(code);
      playScanSound();
      toast({ title: `Товар ${code} отобран к подбору` });
      load();
    } catch (e) {
      playScanErrorSound();
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      setTimeout(() => scanInputRef.current?.focus(), 0);
    }
  };

  useScannerAutoSubmit(scanCode, handleScan, !scanning);

  const handleCancel = async (id: number) => {
    try {
      await cancelPicking(id);
      toast({ title: 'Товар возвращён на хранение' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // Вещи, которые система сама подобрала под заказы: ждут, чтобы кладовщик наклеил
  // стикер отправления. Это и есть «новая работа», прилетающая в течение дня.
  const awaitingLabel = inStock.filter((i) => i.reservedOrderId && !i.shippingLabeledAt);

  const filteredInStock = inStock.filter((i) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      i.orderNumber?.toLowerCase().includes(q) ||
      i.storageBarcode.toLowerCase().includes(q) ||
      i.product?.toLowerCase().includes(q)
    );
  });

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/crm/inventory/goods-warehouse')} className="mb-2 -ml-2">
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К складу товара
          </Button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">Товар к подбору</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Отсканируйте штрихкод хранения, чтобы отметить товар как отобранный для будущей поставки FBS
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleRematch} disabled={rematching}>
              <Icon
                name={rematching ? 'Loader2' : 'RefreshCw'}
                size={14}
                className={`mr-1.5 ${rematching ? 'animate-spin' : ''}`}
              />
              Проверить подбор
            </Button>
          </div>
        </div>

        {awaitingLabel.length > 0 && (
          <Card className="border-destructive/40 bg-destructive/5 shadow-none">
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon name="BellRing" size={20} className="text-destructive" />
                  <div>
                    <p className="font-semibold">
                      Новая работа: {awaitingLabel.length} шт. подобрано под заказы
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Заберите вещи с полок и наклейте стикеры отправления — шить их не нужно
                    </p>
                  </div>
                </div>
                <Button onClick={() => setShipLabelOpen(true)}>
                  <Icon name="Tag" size={16} className="mr-2" />
                  Наклеить стикеры
                </Button>
              </div>

              <div className="rounded-md border border-border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Штрихкод</TableHead>
                      <TableHead>Полка</TableHead>
                      <TableHead>Товар</TableHead>
                      <TableHead>Под заказ</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {awaitingLabel.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono-tech">{i.storageBarcode}</TableCell>
                        <TableCell>{i.shelfName || '—'}</TableCell>
                        <TableCell>{i.product || '—'}</TableCell>
                        <TableCell className="font-medium">{i.reservedOrderNumber || '—'}</TableCell>
                        <TableCell>
                          {/* Вещь испорчена — списываем её, заказ уходит шиться заново,
                              чтобы не висел на подборе бесконечно. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setSewingItem(i)}
                          >
                            <Icon name="Scissors" size={14} className="mr-1" />
                            В пошив
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <ShipLabelDialog
          open={shipLabelOpen}
          onOpenChange={setShipLabelOpen}
          matched={awaitingLabel}
          onDone={load}
        />

        <SendToSewingDialog
          item={sewingItem}
          onOpenChange={(v) => !v && setSewingItem(null)}
          onDone={load}
        />

        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent
            className="space-y-2 pt-6"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('input, button, a')) {
                scanInputRef.current?.focus();
              }
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon name="ScanLine" size={18} />
              Сканер подбора — штрихкод хранения
            </div>
            <div className="flex gap-2">
              <Input
                ref={scanInputRef}
                autoFocus
                placeholder="Штрихкод хранения (GW-000001)"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                disabled={scanning}
                className="font-mono-tech"
              />
              <Button onClick={handleScan} disabled={scanning || !scanCode.trim()}>
                {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Отобрать'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <h2 className="font-semibold">Отобрано к подбору ({picking.length})</h2>
          {picking.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока ничего не отобрано</p>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Штрихкод</TableHead>
                    <TableHead className="text-primary-foreground">Заказ</TableHead>
                    <TableHead className="text-primary-foreground">Товар</TableHead>
                    <TableHead className="text-primary-foreground">Полка</TableHead>
                    <TableHead className="text-primary-foreground" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {picking.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono-tech">{i.storageBarcode}</TableCell>
                      <TableCell>{i.orderNumber || '—'}</TableCell>
                      <TableCell>{i.product || '—'}</TableCell>
                      <TableCell>{i.shelfName || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleCancel(i.id)}>
                            <Icon name="Undo2" size={14} className="mr-1" />
                            Вернуть на хранение
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setSewingItem(i)}
                          >
                            <Icon name="Scissors" size={14} className="mr-1" />
                            В пошив
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">На хранении ({filteredInStock.length})</h2>
            <Input
              placeholder="Поиск по заказу/штрихкоду/товару"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-72"
            />
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Загрузка...
            </div>
          ) : filteredInStock.length === 0 ? (
            <p className="text-sm text-muted-foreground">Товаров на хранении не найдено</p>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Штрихкод</TableHead>
                    <TableHead>Заказ</TableHead>
                    <TableHead>Товар</TableHead>
                    <TableHead>Полка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInStock.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono-tech">{i.storageBarcode}</TableCell>
                      <TableCell>{i.orderNumber || '—'}</TableCell>
                      <TableCell>{i.product || '—'}</TableCell>
                      <TableCell>{i.shelfName || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default GoodsPicking;
