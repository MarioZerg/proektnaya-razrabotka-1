import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
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
import { fetchShipments, createShipmentDefectWriteoff, type Shipment } from '@/lib/shipmentsApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import { formatDateTime as formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';

interface ItemRow {
  rollId: string;
  quantity: string;
}

const emptyRow: ItemRow = { rollId: '', quantity: '' };

const DefectWriteoff = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  // СПИСЫВАТЬ БРАК ВРУЧНУЮ КЛАДОВЩИК НЕ МОЖЕТ.
  //
  // Брак заводит тот, кто нашёл его физически: закройщик отставляет рулон, а
  // упаковщица списывает кусок на терминале в цехе. Кладовщик потом принимает
  // куски сканером в «Приём брака из цеха» — то есть подтверждает уже
  // заявленное. Ручное списание здесь позволяло ему снять метраж с любого
  // рулона задним числом, минуя цех: остаток переставал сходиться с
  // фактическим, а виноватого в недостаче было не найти.
  //
  // Поэтому для кладовщика страница — только история: видно, что и за что
  // списано, но завести новое списание нельзя.
  const readOnly = isStorekeeperRole(user?.role);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<ItemRow[]>([{ ...emptyRow }]);

  const load = () => {
    setLoading(true);
    // Рулоны для формы списания грузим отдельно: если связь моргнула и они не дошли,
    // список отгрузок всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchRolls()
      .then((rollsData) => setRolls(rollsData.filter((r) => r.status !== 'completed')))
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchShipments('defect_writeoff')
      .then(setShipments)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
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
      await createShipmentDefectWriteoff({
        comment: comment.trim() || undefined,
        items,
      });
      toast({ title: 'Списание брака оформлено' });
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Списание брака</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {readOnly
                ? 'История списаний брака. Брак заводят в цехе, вы принимаете куски сканером в «Приём брака из цеха»'
                : 'Списание бракованного материала с остатка рулона'}
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            {!readOnly && (
              <DialogTrigger asChild>
                <Button onClick={openCreate}>
                  <Icon name="Plus" size={16} className="mr-2" />
                  Новое списание
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Списание брака</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                              {r.barcode} · {r.materialName} (ост. {formatQuantity(r.remainingQuantity)} {r.unit})
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
                  <Label>Комментарий (причина брака)</Label>
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
                </div>

                <Button className="w-full" onClick={handleSave} disabled={saving}>
                  {saving ? 'Сохранение...' : 'Оформить списание'}
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
          <p className="text-sm text-muted-foreground">Списаний пока нет</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
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

export default DefectWriteoff;