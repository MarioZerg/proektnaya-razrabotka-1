import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchSupplies, createSupply, type Supply } from '@/lib/marketplaceSuppliesApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

const formatDate = (iso: string) => {
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

const ToMarketplace = () => {
  const { toast } = useToast();
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [availableGoods, setAvailableGoods] = useState<GoodsWarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [marketplace, setMarketplace] = useState('');
  const [comment, setComment] = useState('');
  const [selectedGoods, setSelectedGoods] = useState<number[]>([]);

  const load = () => {
    setLoading(true);
    Promise.all([fetchSupplies(), fetchGoodsWarehouse('in_stock')])
      .then(([suppliesData, goodsData]) => {
        setSupplies(suppliesData);
        setAvailableGoods(goodsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setMarketplace('');
    setComment('');
    setSelectedGoods([]);
    setDialogOpen(true);
  };

  const toggleGood = (id: number) => {
    setSelectedGoods((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (!marketplace) {
      toast({ title: 'Выберите маркетплейс', variant: 'destructive' });
      return;
    }
    if (selectedGoods.length === 0) {
      toast({ title: 'Выберите хотя бы один товар', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createSupply({
        marketplace,
        comment: comment.trim() || undefined,
        goodsWarehouseIds: selectedGoods,
      });
      toast({ title: 'Поставка оформлена' });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Поставки в маркетплейс</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Формирование отгрузки готового товара со склада на маркетплейс
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Icon name="Plus" size={16} className="mr-2" />
                Новая поставка
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Поставка в маркетплейс</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Маркетплейс</Label>
                  <Select value={marketplace} onValueChange={setMarketplace}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите маркетплейс" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OZON">OZON</SelectItem>
                      <SelectItem value="WB">Wildberries</SelectItem>
                      <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Товары на складе ({availableGoods.length})</Label>
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {availableGoods.length === 0 ? (
                      <p className="p-2 text-sm text-muted-foreground">На складе нет готового товара</p>
                    ) : (
                      availableGoods.map((g) => (
                        <label
                          key={g.id}
                          className="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-muted"
                        >
                          <Checkbox
                            checked={selectedGoods.includes(g.id)}
                            onCheckedChange={() => toggleGood(g.id)}
                          />
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
                </div>

                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
                </div>

                <Button className="w-full" onClick={handleSave} disabled={saving}>
                  {saving ? 'Сохранение...' : `Оформить поставку (${selectedGoods.length})`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : supplies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Поставок пока нет</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                  <TableHead className="text-primary-foreground">Товаров</TableHead>
                  <TableHead className="text-primary-foreground">Комментарий</TableHead>
                  <TableHead className="text-primary-foreground">Отгружено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplies.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={marketplaceLogo[s.marketplace]?.className}>
                        {marketplaceLogo[s.marketplace]?.label || s.marketplace}
                      </span>
                    </TableCell>
                    <TableCell>{s.itemsCount}</TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{s.shippedAt ? formatDate(s.shippedAt) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ToMarketplace;
