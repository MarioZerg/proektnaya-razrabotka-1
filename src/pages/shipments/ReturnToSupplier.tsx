import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { fetchShipments, createShipmentReturnToSupplier, type Shipment } from '@/lib/shipmentsApi';
import { fetchSuppliers, type Supplier } from '@/lib/suppliersApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';

interface ItemRow {
  rollId: string;
  quantity: string;
}

const emptyRow: ItemRow = { rollId: '', quantity: '' };

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

const ReturnToSupplier = () => {
  const { toast } = useToast();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...emptyRow }]);

  const load = () => {
    setLoading(true);
    Promise.all([fetchShipments('return_to_supplier'), fetchSuppliers(), fetchRolls()])
      .then(([shipmentsData, suppliersData, rollsData]) => {
        setShipments(shipmentsData);
        setSuppliers(suppliersData);
        setRolls(rollsData.filter((r) => r.status !== 'completed'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setSupplierId('');
    setComment('');
    setRows([{ ...emptyRow }]);
    setDialogOpen(true);
  };

  const addRow = () => setRows((r) => [...r, { ...emptyRow }]);
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: keyof ItemRow, value: string) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const handleSave = async () => {
    const items = rows
      .filter((r) => r.rollId && r.quantity)
      .map((r) => ({ rollId: Number(r.rollId), quantity: Number(r.quantity) }));
    if (items.length === 0) {
      toast({ title: 'Добавьте хотя бы одну позицию', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createShipmentReturnToSupplier({
        supplierId: supplierId ? Number(supplierId) : undefined,
        comment: comment.trim() || undefined,
        items,
      });
      toast({ title: 'Возврат поставщику оформлен' });
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
            <h1 className="text-xl font-bold">Возврат поставщику</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Списание материала с рулонов при возврате поставщику
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Icon name="Plus" size={16} className="mr-2" />
                Новый возврат
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Возврат поставщику</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Поставщик</Label>
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите поставщика" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Позиции</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addRow}>
                      <Icon name="Plus" size={14} className="mr-1" />
                      Добавить
                    </Button>
                  </div>
                  {rows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_100px_auto] gap-2">
                      <Select value={row.rollId} onValueChange={(v) => updateRow(idx, 'rollId', v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Рулон" />
                        </SelectTrigger>
                        <SelectContent>
                          {rolls.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                              {r.barcode} · {r.materialName} (ост. {r.remainingQuantity} {r.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Кол-во"
                        value={row.quantity}
                        onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeRow(idx)}
                        disabled={rows.length === 1}
                      >
                        <Icon name="Trash2" size={16} />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
                </div>

                <Button className="w-full" onClick={handleSave} disabled={saving}>
                  {saving ? 'Сохранение...' : 'Оформить возврат'}
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
        ) : shipments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Возвратов пока нет</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Поставщик</TableHead>
                  <TableHead className="text-primary-foreground">Позиций</TableHead>
                  <TableHead className="text-primary-foreground">Комментарий</TableHead>
                  <TableHead className="text-primary-foreground">Создано</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.status}</Badge>
                    </TableCell>
                    <TableCell>{s.supplierName || '—'}</TableCell>
                    <TableCell>{s.itemsCount}</TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
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

export default ReturnToSupplier;