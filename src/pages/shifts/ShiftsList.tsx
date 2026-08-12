import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchShifts, createShift, deleteShift, type ShiftListItem } from '@/lib/shiftsApi';
import { autoCloseShifts } from '@/lib/shiftSessionsApi';

const ShiftsList = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [shifts, setShifts] = useState<ShiftListItem[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [autoClosing, setAutoClosing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createWorkshopId, setCreateWorkshopId] = useState('');
  const [creating, setCreating] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    // Каждый запрос идёт сам по себе: если связь моргнула и справочник цехов не дошёл,
    // список смен всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchWorkshops().then(setWorkshops).catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchShifts()
      .then(setShifts)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setCreateName('');
    setCreateWorkshopId(workshops[0] ? String(workshops[0].id) : '');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createWorkshopId) {
      toast({ title: 'Укажите название и выберите цех', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await createShift({ workshopId: Number(createWorkshopId), name: createName.trim() });
      toast({ title: 'Смена создана', description: createName.trim() });
      setCreateOpen(false);
      load();
    } catch (err) {
      toast({
        title: 'Не удалось создать смену',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteShift(deleteId);
      toast({ title: 'Смена удалена' });
      setDeleteId(null);
      load();
    } catch (err) {
      toast({
        title: 'Не удалось удалить смену',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  // Смены, которые сотрудники забыли закрыть, закрываются концом рабочего дня из настроек
  // цеха. За забытую смену начисляется штраф, а если за швеёй/закройщиком ещё висели
  // заказы — повышенный, отдельной настройкой.
  const handleAutoClose = async () => {
    setAutoClosing(true);
    try {
      const res = await autoCloseShifts();
      if (res.closedCount === 0) {
        toast({ title: 'Забытых смен нет', description: 'Все смены закрыты вовремя' });
      } else {
        const withOrders = res.closed.filter((c) => c.ordersInWork > 0).length;
        toast({
          title: `Закрыто смен: ${res.closedCount}`,
          description: withOrders > 0 ? `Из них с заказами в работе: ${withOrders}` : undefined,
        });
      }
    } catch (err) {
      toast({
        title: 'Не удалось закрыть смены',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setAutoClosing(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Смены</h1>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={handleAutoClose}
              disabled={autoClosing}
              title="Закрыть смены, которые сотрудники забыли закрыть"
            >
              <Icon
                name={autoClosing ? 'Loader2' : 'MoonStar'}
                size={16}
                className={`mr-1.5 ${autoClosing ? 'animate-spin' : ''}`}
              />
              Закрыть забытые смены
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
                <Icon name="Plus" size={16} className="mr-1.5" />
                Создать смену
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новая смена</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Название смены</Label>
                    <Input
                      placeholder="Например: Смена № 1"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Цех</Label>
                    <Select value={createWorkshopId} onValueChange={setCreateWorkshopId}>
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
                    <p className="text-xs text-muted-foreground">
                      Данные о цехах берутся с вкладки «Цеха» — там же настраиваются их параметры.
                    </p>
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={creating}
                    className="w-full bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {creating ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Создать'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="outline" onClick={() => navigate('/crm/shifts/calendar')}>
              <Icon name="Calendar" size={16} className="mr-1.5" />
              Календарь смен
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Смен пока нет.</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Цех</TableHead>
                  <TableHead className="text-primary-foreground">Статус смены</TableHead>
                  <TableHead className="text-primary-foreground">Статус цеха</TableHead>
                  <TableHead className="text-primary-foreground">Сотрудники</TableHead>
                  <TableHead className="text-primary-foreground">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s, idx) => (
                  <TableRow key={s.id}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.workshopName}</TableCell>
                    <TableCell>
                      <Badge
                        variant={s.isActive ? 'secondary' : 'outline'}
                        className={s.isActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}
                      >
                        {s.isActive ? 'Активна' : 'Выключена'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={s.workshopIsActive ? 'secondary' : 'outline'}
                        className={s.workshopIsActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}
                      >
                        {s.workshopIsActive ? 'Активен' : 'Выключен'}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.employeesCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="icon"
                          className="bg-sky-500 text-white hover:bg-sky-600"
                          onClick={() => navigate(`/crm/shifts/${s.id}`)}
                        >
                          <Icon name="Eye" size={14} />
                        </Button>
                        <Button size="icon" variant="destructive" onClick={() => setDeleteId(s.id)}>
                          <Icon name="Trash2" size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!loading && shifts.some((s) => !s.workshopIsActive) && (
          <p className="text-xs text-muted-foreground">
            Если цех выключен — все сотрудники его смен могут работать в любой активной смене
            (сами выбирают цех/смену при открытии).
          </p>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить смену?</AlertDialogTitle>
            <AlertDialogDescription>
              Удаление возможно только если в смене нет сотрудников — если сотрудники есть,
              сначала переведите их в другую смену. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default ShiftsList;