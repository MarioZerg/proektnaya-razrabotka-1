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
  DialogTrigger,
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
import { fetchWorkshops, createWorkshop, deleteWorkshop, type Workshop } from '@/lib/workshopsApi';

const Workshops = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createShifts, setCreateShifts] = useState('1');
  const [creating, setCreating] = useState(false);

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await deleteWorkshop(deleteId);
      toast({ title: 'Цех удалён' });
      setDeleteId(null);
      load();
    } catch (err) {
      toast({
        title: 'Не удалось удалить цех',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
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
                      <Badge
                        variant={w.isActive ? 'secondary' : 'outline'}
                        className={w.isActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}
                      >
                        {w.isActive ? 'Активен' : 'Неактивен'}
                      </Badge>
                    </TableCell>
                    <TableCell>{w.shiftsCount}</TableCell>
                    <TableCell>{w.employeesCount}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="icon"
                          className="bg-sky-500 text-white hover:bg-sky-600"
                          onClick={() => navigate(`/crm/shifts/workshops/${w.id}/edit`)}
                        >
                          <Icon name="Pencil" size={14} />
                        </Button>
                        <Button size="icon" variant="destructive" onClick={() => setDeleteId(w.id)}>
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
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить цех?</AlertDialogTitle>
            <AlertDialogDescription>
              Удаление возможно только если у цеха нет ни одной смены — если смены есть,
              сначала удалите их на вкладке «Смены». Действие нельзя отменить.
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

export default Workshops;