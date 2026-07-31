import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  fetchShipments,
  fetchShipmentDetail,
  requestToWorkshop,
  collectScan,
  shipToWorkshop,
  receiveAtWorkshop,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';

interface RequestRow {
  materialId: string;
  requestedQuantity: string;
}

const emptyRow: RequestRow = { materialId: '', requestedQuantity: '' };

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

const statusVariant: Record<string, 'secondary' | 'default' | 'outline'> = {
  Новый: 'secondary',
  Отправлено: 'default',
  Получено: 'outline',
};

const ToWorkshop = () => {
  const { toast } = useToast();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reqWorkshopId, setReqWorkshopId] = useState('');
  const [reqShiftNumber, setReqShiftNumber] = useState('');
  const [reqComment, setReqComment] = useState('');
  const [rows, setRows] = useState<RequestRow[]>([{ ...emptyRow }]);

  const [activeShipment, setActiveShipment] = useState<ShipmentDetail | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchShipments('to_workshop'), fetchWorkshops(), fetchMaterialsData()])
      .then(([shipmentsData, workshopsData, materialsData]) => {
        setShipments(shipmentsData);
        setWorkshops(workshopsData);
        setMaterials(materialsData.materials);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (activeShipment) scanInputRef.current?.focus();
  }, [activeShipment]);

  const openCreate = () => {
    setReqWorkshopId('');
    setReqShiftNumber('');
    setReqComment('');
    setRows([{ ...emptyRow }]);
    setCreateOpen(true);
  };

  const addRow = () => setRows((r) => [...r, { ...emptyRow }]);
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: keyof RequestRow, value: string) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const handleCreate = async () => {
    const items = rows
      .filter((r) => r.materialId && r.requestedQuantity)
      .map((r) => ({ materialId: Number(r.materialId), requestedQuantity: Number(r.requestedQuantity) }));
    if (!reqWorkshopId) {
      toast({ title: 'Выберите цех', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'Добавьте хотя бы одну позицию', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await requestToWorkshop({
        workshopId: Number(reqWorkshopId),
        shiftNumber: reqShiftNumber ? Number(reqShiftNumber) : undefined,
        comment: reqComment.trim() || undefined,
        items,
      });
      toast({ title: 'Заявка создана' });
      setCreateOpen(false);
      load();
      const detail = await fetchShipmentDetail(res.id);
      setActiveShipment(detail);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const openShipment = async (id: number) => {
    const detail = await fetchShipmentDetail(id);
    setActiveShipment(detail);
  };

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code || !activeShipment) return;
    setScanning(true);
    try {
      await collectScan(activeShipment.id, code);
      toast({ title: `Рулон ${code} добавлен` });
      setScanCode('');
      const detail = await fetchShipmentDetail(activeShipment.id);
      setActiveShipment(detail);
    } catch (e) {
      toast({ title: 'Ошибка сканирования', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setScanning(false);
      scanInputRef.current?.focus();
    }
  };

  const handleShip = async () => {
    if (!activeShipment) return;
    try {
      await shipToWorkshop(activeShipment.id);
      toast({ title: 'Заявка отправлена в цех' });
      setActiveShipment(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleReceive = async (id: number) => {
    try {
      await receiveAtWorkshop(id);
      toast({ title: 'Поставка принята в цехе' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  if (activeShipment) {
    const requestedItems = activeShipment.items.filter((i) => i.requestedQuantity !== null);
    const collectedItems = activeShipment.items.filter((i) => i.rollId !== null);
    return (
      <CrmLayout>
        <div className="space-y-6">
          <div>
            <Button variant="ghost" size="sm" onClick={() => setActiveShipment(null)} className="mb-2 -ml-2">
              <Icon name="ChevronLeft" size={16} className="mr-1" />
              К списку
            </Button>
            <h1 className="text-xl font-bold">Сборка поставки #{activeShipment.id}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Запрошено: {requestedItems.map((i) => `${i.materialName} ${i.requestedQuantity}`).join(', ')}
            </p>
          </div>

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
                Отсканируйте штрихкод рулона
              </div>
              <div className="flex gap-2">
                <Input
                  ref={scanInputRef}
                  autoFocus
                  placeholder="Штрихкод рулона"
                  value={scanCode}
                  onChange={(e) => setScanCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  disabled={scanning}
                  className="font-mono-tech"
                />
                <Button onClick={handleScan} disabled={scanning || !scanCode.trim()}>
                  {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {collectedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет отсканированных рулонов</p>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Рулон</TableHead>
                    <TableHead>Материал</TableHead>
                    <TableHead>Кол-во</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collectedItems.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono-tech">{i.rollBarcode}</TableCell>
                      <TableCell>{i.materialName}</TableCell>
                      <TableCell>
                        {i.quantity} {i.unit}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Button onClick={handleShip} disabled={collectedItems.length === 0}>
            <Icon name="Truck" size={16} className="mr-2" />
            Отправить в цех
          </Button>
        </div>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Отгрузка в цех</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Заявка на материал → сборка рулонов сканированием → отправка → приём в цехе
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Icon name="Plus" size={16} className="mr-2" />
                Новая заявка
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Заявка на материал в цех</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Цех</Label>
                    <Select value={reqWorkshopId} onValueChange={setReqWorkshopId}>
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
                    <Select value={reqShiftNumber || 'none'} onValueChange={(v) => setReqShiftNumber(v === 'none' ? '' : v)}>
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
                  <div className="flex items-center justify-between">
                    <Label>Запрашиваемые материалы</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addRow}>
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
                        value={row.requestedQuantity}
                        onChange={(e) => updateRow(idx, 'requestedQuantity', e.target.value)}
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
                  <Textarea value={reqComment} onChange={(e) => setReqComment(e.target.value)} rows={2} />
                </div>

                <Button className="w-full" onClick={handleCreate} disabled={creating}>
                  {creating ? 'Создание...' : 'Создать заявку'}
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
          <p className="text-sm text-muted-foreground">Заявок пока нет</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Цех</TableHead>
                  <TableHead className="text-primary-foreground">Смена</TableHead>
                  <TableHead className="text-primary-foreground">Позиций</TableHead>
                  <TableHead className="text-primary-foreground">Комментарий</TableHead>
                  <TableHead className="text-primary-foreground">Создано</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[s.status] || 'secondary'}>{s.status}</Badge>
                    </TableCell>
                    <TableCell>{s.workshopName || '—'}</TableCell>
                    <TableCell>{s.shiftNumber ? `Смена № ${s.shiftNumber}` : '—'}</TableCell>
                    <TableCell>{s.itemsCount}</TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
                    <TableCell>
                      {s.status === 'Новый' && (
                        <Button size="sm" variant="outline" onClick={() => openShipment(s.id)}>
                          Собрать
                        </Button>
                      )}
                      {s.status === 'Отправлено' && (
                        <Button size="sm" onClick={() => handleReceive(s.id)}>
                          Принять в цехе
                        </Button>
                      )}
                    </TableCell>
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
