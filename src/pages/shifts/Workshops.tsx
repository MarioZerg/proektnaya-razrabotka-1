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
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchWorkshops, createWorkshop, updateWorkshop, type Workshop } from '@/lib/workshopsApi';

const Workshops = () => {
  const { toast } = useToast();
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createShifts, setCreateShifts] = useState('1');
  const [creating, setCreating] = useState(false);

  const [editWorkshop, setEditWorkshop] = useState<Workshop | null>(null);
  const [editName, setEditName] = useState('');
  const [editShifts, setEditShifts] = useState('1');
  const [editStatus, setEditStatus] = useState('active');
  const [editSaving, setEditSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchWorkshops()
      .then(setWorkshops)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setCreateName('');
    setCreateShifts('1');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      await createWorkshop(createName.trim(), Number(createShifts) || 1);
      setCreateOpen(false);
      load();
      toast({ title: 'Цех создан', description: createName.trim() });
    } catch (err) {
      toast({
        title: 'Не удалось создать цех',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const openEdit = (w: Workshop) => {
    setEditWorkshop(w);
    setEditName(w.name);
    setEditShifts(String(w.shiftsCount));
    setEditStatus(w.isActive ? 'active' : 'inactive');
  };

  const closeEdit = () => {
    setEditWorkshop(null);
  };

  const handleEditSave = async () => {
    if (!editWorkshop || !editName.trim()) return;
    setEditSaving(true);
    try {
      await updateWorkshop(editWorkshop.id, {
        name: editName.trim(),
        shiftsCount: Number(editShifts) || 1,
        isActive: editStatus === 'active',
      });
      closeEdit();
      load();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Цеха</h1>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
              <Icon name="Plus" size={16} className="mr-1.5" />
              Создать цех
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый цех</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Название</Label>
                <Input
                  placeholder="Например: Цех №3"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Количество смен</Label>
                <Input
                  type="number"
                  min={1}
                  value={createShifts}
                  onChange={(e) => setCreateShifts(e.target.value)}
                />
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

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Смены</TableHead>
                  <TableHead className="text-primary-foreground">Сотрудники</TableHead>
                  <TableHead className="text-primary-foreground">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workshops.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>{w.id}</TableCell>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant={w.isActive ? 'secondary' : 'outline'} className={w.isActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}>
                        {w.isActive ? 'Активен' : 'Неактивен'}
                      </Badge>
                    </TableCell>
                    <TableCell>{w.shiftsCount}</TableCell>
                    <TableCell>{w.employeesCount}</TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        className="bg-sky-500 text-white hover:bg-sky-600"
                        onClick={() => openEdit(w)}
                      >
                        <Icon name="Pencil" size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={editWorkshop !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Изменить цех</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Название</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Количество смен</Label>
                <Input
                  type="number"
                  min={1}
                  value={editShifts}
                  onChange={(e) => setEditShifts(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Активен</SelectItem>
                    <SelectItem value="inactive">Неактивен</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={handleEditSave}
              disabled={editSaving}
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {editSaving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </CrmLayout>
  );
};

export default Workshops;
