import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  fetchSupplyDetail,
  addSupplyItems,
  removeSupplyItem,
  scanOrderToSupply,
  updateSupply,
  moveSupplyStatus,
  deleteSupply,
  supplyStatusFlow,
  type SupplyDetail,
} from '@/lib/marketplaceSuppliesApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

const statusVariant: Record<string, { className: string }> = {
  Открытая: { className: 'bg-slate-500 text-white hover:bg-slate-500' },
  'На сборке': { className: 'bg-sky-500 text-white hover:bg-sky-500' },
  Отгрузка: { className: 'bg-amber-500 text-white hover:bg-amber-500' },
  Выполнена: { className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
};

const MarketplaceSupplyShow = () => {
  const { id } = useParams();
  const supplyId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [supply, setSupply] = useState<SupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [supplyNumber, setSupplyNumber] = useState('');
  const [supplyBarcode, setSupplyBarcode] = useState('');
  const [cluster, setCluster] = useState('');
  const [gazelkaId, setGazelkaId] = useState('');
  const [comment, setComment] = useState('');

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [availableGoods, setAvailableGoods] = useState<GoodsWarehouseItem[]>([]);
  const [selectedGoods, setSelectedGoods] = useState<number[]>([]);

  const [readyGoods, setReadyGoods] = useState<GoodsWarehouseItem[]>([]);

  const [scanOrderNumber, setScanOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchSupplyDetail(supplyId), fetchGoodsWarehouse('in_stock')])
      .then(([data, goods]) => {
        setSupply(data);
        setReadyGoods(goods);
        setSupplyNumber(data.supplyNumber || '');
        setSupplyBarcode(data.supplyBarcode || '');
        setCluster(data.cluster || '');
        setGazelkaId(data.gazelkaId || '');
        setComment(data.comment || '');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyId]);

  const openAddDialog = () => {
    setSelectedGoods([]);
    fetchGoodsWarehouse('in_stock').then(setAvailableGoods);
    setAddDialogOpen(true);
  };

  const toggleGood = (gid: number) => {
    setSelectedGoods((prev) => (prev.includes(gid) ? prev.filter((g) => g !== gid) : [...prev, gid]));
  };

  const handleAddItems = async () => {
    if (selectedGoods.length === 0) {
      toast({ title: 'Выберите хотя бы один товар', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addSupplyItems(supplyId, selectedGoods);
      toast({ title: 'Товары добавлены в поставку' });
      setAddDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleScanOrder = async () => {
    const orderNumber = scanOrderNumber.trim();
    if (!orderNumber) return;
    setScanning(true);
    try {
      await scanOrderToSupply(supplyId, orderNumber);
      toast({ title: `Заказ ${orderNumber} добавлен` });
      setScanOrderNumber('');
      load();
    } catch (e) {
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      scanInputRef.current?.focus();
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    try {
      await removeSupplyItem(itemId);
      toast({ title: 'Товар убран из поставки' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleSaveFields = async () => {
    setSaving(true);
    try {
      await updateSupply(supplyId, {
        supplyNumber,
        supplyBarcode,
        cluster,
        gazelkaId,
        comment,
      });
      toast({ title: 'Данные поставки сохранены' });
      load();
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
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSupply(supplyId);
      toast({ title: 'Поставка удалена' });
      navigate('/crm/shipments/to-marketplace');
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  if (loading || !supply) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  const nextStatus = supplyStatusFlow[supplyStatusFlow.indexOf(supply.status) + 1];
  const canEditItems = supply.status === 'Открытая' || supply.status === 'На сборке';

  const nextStatusLabel: Record<string, string> = {
    'На сборке': 'Взять на сборку',
    Отгрузка: supply.type === 'FBS' ? 'Закрыть поставку и передать в доставку' : 'Отгрузить в Газельку',
    Выполнена: 'Отметить выполненной',
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/crm/shipments/to-marketplace')} className="mb-2 -ml-2">
              <Icon name="ChevronLeft" size={16} className="mr-1" />
              К списку
            </Button>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold">Поставка #{supply.id}</h1>
              <Badge className={statusVariant[supply.status]?.className}>{supply.status}</Badge>
              <span className={marketplaceLogo[supply.marketplace]?.className}>
                {marketplaceLogo[supply.marketplace]?.label || supply.marketplace}
              </span>
              <Badge variant="outline">{supply.type}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Создана {formatDateTime(supply.createdAt)}
              {supply.createdByName && ` — ${supply.createdByName}`}
            </p>
          </div>
          <div className="flex gap-2">
            {supply.status === 'Открытая' && (
              <Button variant="destructive" onClick={handleDelete}>
                <Icon name="Trash2" size={16} className="mr-2" />
                Удалить
              </Button>
            )}
            {nextStatus && (
              <Button onClick={handleMoveStatus} disabled={saving}>
                <Icon name="ArrowRight" size={16} className="mr-2" />
                {nextStatusLabel[nextStatus] || nextStatus}
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4 rounded-md border border-border p-4">
            <h2 className="font-semibold">Данные поставки</h2>
            <div className="space-y-1.5">
              <Label>Номер поставки</Label>
              <Input value={supplyNumber} onChange={(e) => setSupplyNumber(e.target.value)} placeholder="Номер в маркетплейсе" />
            </div>
            <div className="space-y-1.5">
              <Label>Штрихкод поставки</Label>
              <Input value={supplyBarcode} onChange={(e) => setSupplyBarcode(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Кластер / регион</Label>
              <Input value={cluster} onChange={(e) => setCluster(e.target.value)} placeholder="Например: Москва, МО и Дальние регионы" />
            </div>
            <div className="space-y-1.5">
              <Label>id Газельки</Label>
              <Input value={gazelkaId} onChange={(e) => setGazelkaId(e.target.value)} placeholder="Номер рейса развоза" />
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
            </div>
            <Button onClick={handleSaveFields} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>

          <div className="space-y-4 rounded-md border border-border p-4">
            <h2 className="font-semibold">Даты этапов</h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Создана</span>
                <span className="font-medium">{formatDateTime(supply.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Отгрузка в Газельку</span>
                <span className="font-medium">
                  {supply.shipToGazelkaAt ? formatDateTime(supply.shipToGazelkaAt) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-muted-foreground">Отгрузка в маркетплейс</span>
                <span className="font-medium">
                  {supply.shipToMarketplaceAt ? formatDateTime(supply.shipToMarketplaceAt) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Выполнена</span>
                <span className="font-medium">
                  {supply.completedAt ? formatDateTime(supply.completedAt) : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            {supply.type === 'FBS' ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <span>
                  Готово к сканированию: <b>{readyGoods.length}</b>
                </span>
                <span>
                  Добавлено товаров: <b>{supply.items.length}</b>
                </span>
              </div>
            ) : (
              <h2 className="font-semibold">Товары в поставке ({supply.items.length})</h2>
            )}
            {canEditItems && supply.type === 'FBO' && (
              <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" onClick={openAddDialog}>
                    <Icon name="Plus" size={14} className="mr-1" />
                    Добавить товары
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Добавить товары со склада</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                      {availableGoods.length === 0 ? (
                        <p className="p-2 text-sm text-muted-foreground">На складе нет готового товара</p>
                      ) : (
                        availableGoods.map((g) => (
                          <label
                            key={g.id}
                            className="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-muted"
                          >
                            <Checkbox checked={selectedGoods.includes(g.id)} onCheckedChange={() => toggleGood(g.id)} />
                            <span className="text-sm font-medium">{g.orderNumber}</span>
                            <span className="text-xs text-muted-foreground">
                              {g.material} {g.width}×{g.height}
                            </span>
                            {g.shelfName && (
                              <Badge variant="outline" className="ml-auto text-xs">
                                {g.shelfName}
                              </Badge>
                            )}
                          </label>
                        ))
                      )}
                    </div>
                    <Button className="w-full" onClick={handleAddItems} disabled={saving}>
                      {saving ? 'Добавление...' : `Добавить (${selectedGoods.length})`}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {canEditItems && supply.type === 'FBS' && (
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
                  Отсканируйте или введите номер заказа
                </div>
                <div className="flex gap-2">
                  <Input
                    ref={scanInputRef}
                    autoFocus
                    placeholder="Номер заказа"
                    value={scanOrderNumber}
                    onChange={(e) => setScanOrderNumber(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleScanOrder()}
                    disabled={scanning}
                    className="font-mono-tech"
                  />
                  <Button onClick={handleScanOrder} disabled={scanning || !scanOrderNumber.trim()}>
                    {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить заказ'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {supply.type === 'FBS' ? (
            readyGoods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет готовых товаров, ожидающих сканирования
              </p>
            ) : (
              <div className="rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="text-primary-foreground">Номер заказа</TableHead>
                      <TableHead className="text-primary-foreground">Товар</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {readyGoods.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.orderNumber || '—'}</TableCell>
                        <TableCell>{g.product || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : supply.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">В поставке пока нет товаров</p>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Заказ</TableHead>
                    <TableHead className="text-primary-foreground">Товар</TableHead>
                    <TableHead className="text-primary-foreground">Материал</TableHead>
                    <TableHead className="text-primary-foreground">Размер</TableHead>
                    <TableHead className="text-primary-foreground">Статус</TableHead>
                    {canEditItems && <TableHead className="text-primary-foreground"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supply.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.orderNumber || '—'}</TableCell>
                      <TableCell>{item.product || '—'}</TableCell>
                      <TableCell>{item.material || '—'}</TableCell>
                      <TableCell>
                        {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {item.goodsStatus === 'reserved' ? 'Зарезервирован' : item.goodsStatus === 'shipped' ? 'Отгружен' : item.goodsStatus}
                        </Badge>
                      </TableCell>
                      {canEditItems && (
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(item.id)}>
                            <Icon name="Trash2" size={14} />
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
      </div>
    </CrmLayout>
  );
};

export default MarketplaceSupplyShow;