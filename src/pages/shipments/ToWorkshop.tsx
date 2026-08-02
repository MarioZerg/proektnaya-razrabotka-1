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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchShipments,
  fetchShipmentDetail,
  requestToWorkshop,
  collectScan,
  shipToWorkshop,
  receiveAtWorkshop,
  deleteShipment,
  type Shipment,
  type ShipmentDetail,
} from '@/lib/shipmentsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';

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
  const { user } = useAuth();
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  const isAdmin = user?.role === 'admin';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reqWorkshopId, setReqWorkshopId] = useState('');
  const [reqShiftNumber, setReqShiftNumber] = useState('');
  const [reqComment, setReqComment] = useState('');
  const [reqMaterialId, setReqMaterialId] = useState('');
  const [reqQuantity, setReqQuantity] = useState('');

  const [activeShipment, setActiveShipment] = useState<ShipmentDetail | null>(null);
  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  const shiftLabel = (workshopId: number | null, shiftNumber: number | null) => {
    if (!shiftNumber) return '—';
    const w = workshops.find((wk) => wk.id === workshopId);
    return w?.shiftNames?.[shiftNumber - 1] || `Смена № ${shiftNumber}`;
  };

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
    setReqWorkshopId(isProduction && user?.workshopId ? String(user.workshopId) : '');
    setReqShiftNumber(isProduction && user?.shiftNumber ? String(user.shiftNumber) : '');
    setReqComment('');
    setReqMaterialId('');
    setReqQuantity('');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!isProduction && !reqWorkshopId) {
      toast({ title: 'Выберите цех', variant: 'destructive' });
      return;
    }
    if (isProduction && !user?.workshopId) {
      toast({ title: 'За вами не закреплён цех — обратитесь к администратору', variant: 'destructive' });
      return;
    }
    if (!reqMaterialId || !reqQuantity) {
      toast({ title: 'Укажите материал и количество', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await requestToWorkshop({
        workshopId: isProduction ? Number(user!.workshopId) : Number(reqWorkshopId),
        shiftNumber: isProduction
          ? (user?.shiftNumber ?? undefined)
          : reqShiftNumber
            ? Number(reqShiftNumber)
            : undefined,
        comment: reqComment.trim() || undefined,
        materialId: Number(reqMaterialId),
        requestedQuantity: Number(reqQuantity),
        requestedBy: user?.id,
      });
      toast({ title: 'Заявка отправлена кладовщику' });
      setCreateOpen(false);
      load();
      if (!isProduction) {
        const detail = await fetchShipmentDetail(res.id);
        setActiveShipment(detail);
      }
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

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteShipment(deleteId);
      toast({ title: 'Заявка удалена' });
      setDeleteId(null);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  if (activeShipment) {
    const requestedItem = activeShipment.items.find((i) => i.requestedQuantity !== null);
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
              Запрошено: {requestedItem?.materialName} {requestedItem?.requestedQuantity}
              {requestedItem?.unit} · Запросил: {activeShipment.requestedByName || '—'}
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
              {isProduction
                ? 'Запросите нужный материал — кладовщик соберёт рулоны и отправит вам'
                : 'Заявка от швеи/закройщика → сборка рулонов сканированием → отправка → приём в цехе'}
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate}>
                <Icon name="Plus" size={16} className="mr-2" />
                {isProduction ? 'Запросить материал' : 'Новая заявка'}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{isProduction ? 'Запросить материал' : 'Заявка на материал в цех'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {!isProduction && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Цех</Label>
                      <Select
                        value={reqWorkshopId}
                        onValueChange={(v) => {
                          setReqWorkshopId(v);
                          setReqShiftNumber('');
                        }}
                      >
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
                      <Select
                        value={reqShiftNumber || 'none'}
                        onValueChange={(v) => setReqShiftNumber(v === 'none' ? '' : v)}
                        disabled={!reqWorkshopId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Без смены" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Без смены</SelectItem>
                          {(workshops.find((w) => String(w.id) === reqWorkshopId)?.shiftNames ?? []).map(
                            (name, idx) => (
                              <SelectItem key={idx} value={String(idx + 1)}>
                                {name}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Материал</Label>
                  <Select value={reqMaterialId} onValueChange={setReqMaterialId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите материал" />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.name} ({m.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Количество</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Кол-во"
                    value={reqQuantity}
                    onChange={(e) => setReqQuantity(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Одна заявка — один материал.</p>

                <div className="space-y-1.5">
                  <Label>Комментарий</Label>
                  <Textarea value={reqComment} onChange={(e) => setReqComment(e.target.value)} rows={2} />
                </div>

                <Button className="w-full" onClick={handleCreate} disabled={creating}>
                  {creating ? 'Отправка...' : isProduction ? 'Запросить' : 'Создать заявку'}
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
                  <TableHead className="text-primary-foreground">Запросил</TableHead>
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={statusVariant[s.status] || 'secondary'}>{s.status}</Badge>
                        {s.isAutoOrder && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Автозаказ
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{s.workshopName || '—'}</TableCell>
                    <TableCell>{shiftLabel(s.workshopId, s.shiftNumber)}</TableCell>
                    <TableCell>{s.requestedByName || '—'}</TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {!isProduction && s.status === 'Новый' && (
                          <Button size="sm" variant="outline" onClick={() => openShipment(s.id)}>
                            Собрать
                          </Button>
                        )}
                        {!isProduction && s.status === 'Отправлено' && (
                          <Button size="sm" onClick={() => handleReceive(s.id)}>
                            Принять в цехе
                          </Button>
                        )}
                        {isAdmin && (s.status === 'Новый' || s.status === 'Отправлено') && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleteId(s.id)}>
                            <Icon name="Trash2" size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявку на отгрузку в цех?</AlertDialogTitle>
            <AlertDialogDescription>
              Собранные рулоны (если есть) вернутся на склад. Если это был автозаказ —
              система не создаст новый автозаказ по этому материалу/цеху/смене, пока
              следующая заявка на эту же комбинацию не будет принята в цехе. Действие
              нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default ToWorkshop;