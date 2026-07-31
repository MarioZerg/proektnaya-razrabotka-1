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
import { fetchShipments, createShipmentFromSupplier, type Shipment } from '@/lib/shipmentsApi';
import { fetchSuppliers, type Supplier } from '@/lib/suppliersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';

interface ItemRow {
  materialId: string;
  quantity: string;
  numberRolls: string;
}

const emptyRow: ItemRow = { materialId: '', quantity: '', numberRolls: '' };

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

const FromSupplier = () => {
  const { toast } = useToast();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...emptyRow }]);
  const [lastCreatedRolls, setLastCreatedRolls] = useState<string[]>([]);

  const load = () => {
    setLoading(true);
    Promise.all([fetchShipments('from_supplier'), fetchSuppliers(), fetchMaterialsData()])
      .then(([shipmentsData, suppliersData, materialsData]) => {
        setShipments(shipmentsData);
        setSuppliers(suppliersData);
        setMaterials(materialsData.materials);
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
    setLastCreatedRolls([]);
    setDialogOpen(true);
  };

  const addRow = () => setRows((r) => [...r, { ...emptyRow }]);
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: keyof ItemRow, value: string) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const materialUnit = (materialId: string) => materials.find((m) => String(m.id) === materialId)?.unit || '';

  const handleSave = async () => {
    const items = rows
      .filter((r) => r.materialId && r.quantity && r.numberRolls)
      .map((r) => ({
        materialId: Number(r.materialId),
        quantity: Number(r.quantity),
        numberRolls: Number(r.numberRolls),
      }));
    if (items.length === 0) {
      toast({ title: 'Добавьте хотя бы одну позицию', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await createShipmentFromSupplier({
        supplierId: supplierId ? Number(supplierId) : undefined,
        comment: comment.trim() || undefined,
        items,
      });
      toast({
        title: 'Приёмка оформлена',
        description: `Создано рулонов: ${res.createdRolls.length}`,
      });
      setLastCreatedRolls(res.createdRolls);
      setRows([{ ...emptyRow }]);
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
            <h1 className="text-xl font-bold">Отгрузка от поставщика</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Приехала машина — указали материал, общее количество и сколько рулонов/пачек
              привезли, система сама создаст рулоны и поделит количество поровну
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Icon name="Plus" size={16} className="mr-2" />
                Новая приёмка
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Приёмка от поставщика</DialogTitle>
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
                    <Label>Материалы</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addRow}>
                      <Icon name="Plus" size={14} className="mr-1" />
                      Добавить материал
                    </Button>
                  </div>
                  {rows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_100px_100px_auto] gap-2">
                      <Select value={row.materialId} onValueChange={(v) => updateRow(idx, 'materialId', v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Материал" />
                        </SelectTrigger>
                        <SelectContent>
                          {materials.map((m) => (
                            <SelectItem key={m.id} value={String(m.id)}>
                              {m.name} ({m.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder={materialUnit(row.materialId) || 'Кол-во'}
                        value={row.quantity}
                        onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                      />
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        placeholder="Рулонов"
                        value={row.numberRolls}
                        onChange={(e) => updateRow(idx, 'numberRolls', e.target.value)}
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
                  <p className="text-xs text-muted-foreground">
                    Например: пришло 3 пачки пакетов по 1000 шт — материал «Пакет 25х30»,
                    количество 3000, рулонов 3. Штрихкоды рулонов система присвоит сама.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
                </div>

                <Button className="w-full" onClick={handleSave} disabled={saving}>
                  {saving ? 'Сохранение...' : 'Оприходовать'}
                </Button>

                {lastCreatedRolls.length > 0 && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                    <p className="mb-1.5 text-sm font-medium text-emerald-800">
                      Создано рулонов: {lastCreatedRolls.length}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {lastCreatedRolls.map((bc) => (
                        <Badge key={bc} variant="outline" className="font-mono-tech">
                          {bc}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
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
          <p className="text-sm text-muted-foreground">Приёмок пока нет</p>
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

export default FromSupplier;