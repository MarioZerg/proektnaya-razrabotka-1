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
import { fetchShifts, createShift, type ShiftListItem } from '@/lib/shiftsApi';

const ShiftsList = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [shifts, setShifts] = useState<ShiftListItem[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createWorkshopId, setCreateWorkshopId] = useState('');
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([fetchShifts(), fetchWorkshops()])
      .then(([shiftsData, workshopsData]) => {
        setShifts(shiftsData);
        setWorkshops(workshopsData);
      })
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

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Смены</h1>
          <div className="flex gap-3">
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
                      <Button
                        size="icon"
                        className="bg-sky-500 text-white hover:bg-sky-600"
                        onClick={() => navigate(`/crm/shifts/${s.id}`)}
                      >
                        <Icon name="Eye" size={14} />
                      </Button>
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
    </CrmLayout>
  );
};

export default ShiftsList;
