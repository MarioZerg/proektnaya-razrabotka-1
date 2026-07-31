import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchWorkshopMaterials, type WorkshopMaterialType } from '@/lib/workshopMaterialsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { workshopWriteoff } from '@/lib/shipmentsApi';

interface WriteoffRow {
  materialId: string;
  quantity: string;
}

const emptyRow: WriteoffRow = { materialId: '', quantity: '' };

const WorkshopMaterials = () => {
  const { toast } = useToast();
  const [types, setTypes] = useState<WorkshopMaterialType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [woWorkshopId, setWoWorkshopId] = useState('');
  const [woShiftNumber, setWoShiftNumber] = useState('');
  const [woComment, setWoComment] = useState('');
  const [rows, setRows] = useState<WriteoffRow[]>([{ ...emptyRow }]);

  const load = () => {
    setLoading(true);
    Promise.all([fetchWorkshopMaterials(), fetchMaterialsData(), fetchWorkshops()])
      .then(([typesData, materialsData, workshopsData]) => {
        setTypes(typesData);
        setMaterials(materialsData.materials);
        setWorkshops(workshopsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const shiftNumbers = Array.from(
    new Set(types.flatMap((t) => t.materials.flatMap((m) => m.shifts.map((s) => s.shiftNumber))))
  ).sort((a, b) => (a ?? 99) - (b ?? 99));

  const openWriteoff = () => {
    setWoWorkshopId('');
    setWoShiftNumber('');
    setWoComment('');
    setRows([{ ...emptyRow }]);
    setDialogOpen(true);
  };

  const addRow = () => setRows((r) => [...r, { ...emptyRow }]);
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: keyof WriteoffRow, value: string) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const handleWriteoff = async () => {
    const items = rows
      .filter((r) => r.materialId && r.quantity)
      .map((r) => ({ materialId: Number(r.materialId), quantity: Number(r.quantity) }));
    if (items.length === 0) {
      toast({ title: 'Добавьте хотя бы одну позицию', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await workshopWriteoff({
        workshopId: woWorkshopId ? Number(woWorkshopId) : undefined,
        shiftNumber: woShiftNumber ? Number(woShiftNumber) : undefined,
        comment: woComment.trim() || undefined,
        items,
      });
      toast({ title: 'Списание оформлено' });
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
            <h1 className="text-xl font-bold">Материал на производстве</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Остатки материалов в цехах по сменам (рулоны со статусом «в цехе»)
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openWriteoff}>
                <Icon name="Scissors" size={16} className="mr-2" />
                Списание материала
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Списание материала в цехе</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Цех (необязательно)</Label>
                    <Select value={woWorkshopId || 'none'} onValueChange={(v) => setWoWorkshopId(v === 'none' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Любой цех" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Любой цех</SelectItem>
                        {workshops.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Смена (необязательно)</Label>
                    <Select value={woShiftNumber || 'none'} onValueChange={(v) => setWoShiftNumber(v === 'none' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Любая смена" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Любая смена</SelectItem>
                        <SelectItem value="1">Смена № 1</SelectItem>
                        <SelectItem value="2">Смена № 2</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Позиции (спишется автоматически с более старых рулонов)</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addRow} disabled={rows.length >= 5}>
                      <Icon name="Plus" size={14} className="mr-1" />
                      Добавить
                    </Button>
                  </div>
                  {rows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_100px_auto] gap-2">
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
                  <Input value={woComment} onChange={(e) => setWoComment(e.target.value)} />
                </div>

                <Button className="w-full" onClick={handleWriteoff} disabled={saving}>
                  {saving ? 'Сохранение...' : 'Списать'}
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
        ) : types.length === 0 ? (
          <p className="text-sm text-muted-foreground">В цехах пока нет материалов</p>
        ) : (
          <div className="space-y-6">
            {types.map((type) => (
              <div key={type.id} className="rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-4 py-2 text-sm font-semibold">
                  {type.name} — {type.materials.length} поз.
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Материал</TableHead>
                      {shiftNumbers.map((sn) => (
                        <TableHead key={sn ?? 'none'}>{sn ? `Смена № ${sn}` : 'Без смены'}</TableHead>
                      ))}
                      <TableHead>Итого</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {type.materials.map((m) => (
                      <TableRow key={m.materialId}>
                        <TableCell className="font-medium">{m.materialName}</TableCell>
                        {shiftNumbers.map((sn) => {
                          const shift = m.shifts.find((s) => s.shiftNumber === sn);
                          return (
                            <TableCell key={sn ?? 'none'}>
                              {shift ? `${shift.quantity} ${m.unit}, ${shift.rollCount} рул.` : '—'}
                            </TableCell>
                          );
                        })}
                        <TableCell className="font-semibold">
                          {m.totalQuantity} {m.unit}, {m.totalRolls} рул.
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default WorkshopMaterials;