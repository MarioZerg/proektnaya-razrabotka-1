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
import { fetchShipments, createShipmentToWorkshop, type Shipment } from '@/lib/shipmentsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';

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

const ToWorkshop = () => {
  const { toast } = useToast();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workshopId, setWorkshopId] = useState('');
  const [shiftNumber, setShiftNumber] = useState('');
  const [comment, setComment] = useState('');
  const [selectedRolls, setSelectedRolls] = useState<number[]>([]);

  const load = () => {
    setLoading(true);
    Promise.all([fetchShipments('to_workshop'), fetchWorkshops(), fetchRolls({ status: 'in_storage' })])
      .then(([shipmentsData, workshopsData, rollsData]) => {
        setShipments(shipmentsData);
        setWorkshops(workshopsData);
        setRolls(rollsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setWorkshopId('');
    setShiftNumber('');
    setComment('');
    setSelectedRolls([]);
    setDialogOpen(true);
  };

  const toggleRoll = (id: number) => {
    setSelectedRolls((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (!workshopId) {
      toast({ title: 'Выберите цех назначения', variant: 'destructive' });
      return;
    }
    if (selectedRolls.length === 0) {
      toast({ title: 'Выберите хотя бы один рулон', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createShipmentToWorkshop({
        workshopId: Number(workshopId),
        shiftNumber: shiftNumber ? Number(shiftNumber) : undefined,
        comment: comment.trim() || undefined,
        items: selectedRolls.map((rollId) => ({ rollId })),
      });
      toast({ title: 'Отгрузка в цех оформлена' });
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
            <h1 className="text-xl font-bold">Отгрузка в цех</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Перемещение рулонов материалов со склада в цех на смену
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Icon name="Plus" size={16} className="mr-2" />
                Новая отгрузка
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Отгрузка в цех</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Цех</Label>
                    <Select value={workshopId} onValueChange={setWorkshopId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите цех" />
                      </SelectTrigger>
                      <SelectContent>
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
                    <Select value={shiftNumber || 'none'} onValueChange={(v) => setShiftNumber(v === 'none' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Без смены" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Без смены</SelectItem>
                        <SelectItem value="1">Смена № 1</SelectItem>
                        <SelectItem value="2">Смена № 2</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Рулоны на складе ({rolls.length})</Label>
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {rolls.length === 0 ? (
                      <p className="p-2 text-sm text-muted-foreground">На складе нет доступных рулонов</p>
                    ) : (
                      rolls.map((r) => (
                        <label
                          key={r.id}
                          className="flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-muted"
                        >
                          <Checkbox
                            checked={selectedRolls.includes(r.id)}
                            onCheckedChange={() => toggleRoll(r.id)}
                          />
                          <span className="font-mono-tech text-xs">{r.barcode}</span>
                          <span className="text-sm">{r.materialName}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {r.remainingQuantity} {r.unit}
                          </span>
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
                  {saving ? 'Сохранение...' : `Отгрузить (${selectedRolls.length})`}
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
          <p className="text-sm text-muted-foreground">Отгрузок пока нет</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Цех</TableHead>
                  <TableHead className="text-primary-foreground">Смена</TableHead>
                  <TableHead className="text-primary-foreground">Рулонов</TableHead>
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
                    <TableCell>{s.workshopName || '—'}</TableCell>
                    <TableCell>{s.shiftNumber ? `Смена № ${s.shiftNumber}` : '—'}</TableCell>
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

export default ToWorkshop;
