import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchShiftDetail,
  updateShift,
  addEmployeeToShift,
  removeEmployeeFromShift,
  type ShiftDetail as ShiftDetailData,
} from '@/lib/shiftsApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { roleLabels, type Role } from '@/lib/roles';

const ShiftDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [shift, setShift] = useState<ShiftDetailData | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  // Редактирование названия смены прямо в заголовке: клик по карандашу — поле ввода.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([fetchShiftDetail(Number(id)), fetchEmployees()])
      .then(([shiftData, employeesData]) => {
        setShift(shiftData);
        setEmployees(employeesData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleToggleActive = async () => {
    if (!shift) return;
    setToggling(true);
    try {
      await updateShift(shift.id, { isActive: !shift.isActive });
      toast({
        title: shift.isActive
          ? 'Смена выключена — сотрудники смогут работать в любой смене'
          : 'Смена включена',
      });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setToggling(false);
    }
  };

  const handleAddEmployee = async () => {
    if (!shift || !addUserId) return;
    setAdding(true);
    try {
      await addEmployeeToShift(shift.id, Number(addUserId));
      toast({ title: 'Сотрудник добавлен в смену' });
      setAddUserId('');
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveEmployee = async (userId: number) => {
    setRemovingId(userId);
    try {
      await removeEmployeeFromShift(userId);
      toast({ title: 'Сотрудник убран из смены' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setRemovingId(null);
    }
  };

  // Сотрудники, которых можно добавить — не состоящие уже в этой смене (в других сменах или
  const handleSaveName = async () => {
    if (!shift) return;
    const name = nameDraft.trim();
    if (!name) {
      toast({ title: 'Название не может быть пустым', variant: 'destructive' });
      return;
    }
    if (name === shift.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await updateShift(shift.id, { name });
      toast({ title: 'Название смены изменено' });
      setEditingName(false);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось переименовать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingName(false);
    }
  };

  // без смены вообще). Админ сюда не добавляется — у него нет привязки к цеху/смене.
  const availableEmployees = employees.filter(
    (e) => e.role !== 'admin' && !shift?.employees.some((se) => se.id === e.id)
  );

  if (loading || !shift) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/crm/shifts/list')} className="mb-2 -ml-2">
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К списку смен
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            {editingName ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  className="h-9 w-56 text-base font-bold"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                />
                <Button size="sm" onClick={handleSaveName} disabled={savingName}>
                  {savingName ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>
                  Отмена
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{shift.name}</h1>
                <button
                  onClick={() => {
                    setNameDraft(shift.name);
                    setEditingName(true);
                  }}
                  className="text-muted-foreground transition hover:text-foreground"
                  aria-label="Переименовать смену"
                >
                  <Icon name="Pencil" size={16} />
                </button>
              </div>
            )}
            <Badge
              variant={shift.isActive ? 'secondary' : 'outline'}
              className={shift.isActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}
            >
              {shift.isActive ? 'Активна' : 'Выключена'}
            </Badge>
            <Badge
              variant={shift.workshopIsActive ? 'secondary' : 'outline'}
              className={shift.workshopIsActive ? 'bg-emerald-600 text-white hover:bg-emerald-600' : ''}
            >
              Цех: {shift.workshopIsActive ? 'Активен' : 'Выключен'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{shift.workshopName}</p>
        </div>

        <Card className="border-border shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Если смена выключена — все её сотрудники смогут работать в любой активной смене
              (сами выбирают цех/смену при открытии).
            </p>
            <Button variant={shift.isActive ? 'destructive' : 'default'} disabled={toggling} onClick={handleToggleActive}>
              {toggling ? (
                <Icon name="Loader2" size={16} className="animate-spin" />
              ) : shift.isActive ? (
                'Выключить смену'
              ) : (
                'Включить смену'
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Добавить сотрудника в смену</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1 space-y-1.5">
              <Select value={addUserId} onValueChange={setAddUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {availableEmployees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.fullName} — {roleLabels[e.role as Role] || e.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddEmployee} disabled={adding || !addUserId}>
              {adding ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
            </Button>
          </CardContent>
        </Card>

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">Сотрудник</TableHead>
                <TableHead className="text-primary-foreground">Должность</TableHead>
                <TableHead className="text-primary-foreground">Свободный график</TableHead>
                <TableHead className="text-primary-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shift.employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    В этой смене пока нет сотрудников
                  </TableCell>
                </TableRow>
              ) : (
                shift.employees.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.fullName}</TableCell>
                    <TableCell>{roleLabels[e.role as Role] || e.role}</TableCell>
                    <TableCell>
                      {e.shiftFree ? (
                        <Badge variant="outline">Работает в любой смене</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={removingId === e.id}
                        onClick={() => handleRemoveEmployee(e.id)}
                      >
                        {removingId === e.id ? (
                          <Icon name="Loader2" size={14} className="animate-spin" />
                        ) : (
                          <Icon name="X" size={14} />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </CrmLayout>
  );
};

export default ShiftDetailPage;
