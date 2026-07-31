import { useEffect, useRef, useState } from 'react';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { roleLabels, type Role } from '@/lib/roles';
import {
  fetchEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  type Employee,
} from '@/lib/usersApi';

const roleOptions = Object.keys(roleLabels) as Role[];
const workshopOptions = ['Цех №1', 'Цех №2'];

const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface CreateFormState {
  fullName: string;
  email: string;
  role: Role;
  password: string;
  workshop: string;
  avatarBase64: string;
}

const emptyCreateForm: CreateFormState = {
  fullName: '',
  email: '',
  role: 'sewer',
  password: '',
  workshop: '',
  avatarBase64: '',
};

interface CardFormState {
  fullName: string;
  role: Role;
  workshop: string;
  salary: string;
  shiftFrom: string;
  shiftTo: string;
  newPassword: string;
  avatarBase64: string;
}

const UsersSettings = () => {
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [workshopFilter, setWorkshopFilter] = useState<string>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [creating, setCreating] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);

  const [cardEmployee, setCardEmployee] = useState<Employee | null>(null);
  const [cardForm, setCardForm] = useState<CardFormState | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const cardFileRef = useRef<HTMLInputElement>(null);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchEmployees()
      .then(setEmployees)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const openCreate = () => {
    setCreateForm(emptyCreateForm);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createForm.fullName.trim() || !createForm.email.trim() || !createForm.password.trim()) return;
    setCreating(true);
    try {
      const result = await createEmployee({
        fullName: createForm.fullName.trim(),
        email: createForm.email.trim(),
        role: createForm.role,
        password: createForm.password,
        workshop: createForm.workshop || undefined,
        avatarBase64: createForm.avatarBase64 || undefined,
      });
      setCreateOpen(false);
      load();
      toast({
        title: 'Сотрудник добавлен',
        description: `Логин для входа: ${result.login} — сообщите его сотруднику вместе с паролем`,
      });
    } catch (err) {
      toast({
        title: 'Не удалось добавить сотрудника',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const openCard = (emp: Employee) => {
    setCardEmployee(emp);
    setCardForm({
      fullName: emp.fullName,
      role: emp.role,
      workshop: emp.workshop || '',
      salary: String(emp.salary || 0),
      shiftFrom: emp.shiftFrom || '',
      shiftTo: emp.shiftTo || '',
      newPassword: '',
      avatarBase64: '',
    });
  };

  const closeCard = () => {
    setCardEmployee(null);
    setCardForm(null);
  };

  const handleCardSave = async () => {
    if (!cardEmployee || !cardForm) return;
    setCardSaving(true);
    try {
      await updateEmployee(cardEmployee.id, {
        fullName: cardForm.fullName.trim(),
        role: cardForm.role,
        workshop: cardForm.workshop || '',
        salary: Number(cardForm.salary) || 0,
        shiftFrom: cardForm.shiftFrom || null,
        shiftTo: cardForm.shiftTo || null,
        ...(cardForm.newPassword.trim() ? { password: cardForm.newPassword.trim() } : {}),
        ...(cardForm.avatarBase64 ? { avatarBase64: cardForm.avatarBase64 } : {}),
      });
      closeCard();
      load();
      toast({ title: 'Изменения сохранены' });
    } catch (err) {
      toast({
        title: 'Не удалось сохранить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCardSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteEmployee(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null);
      toast({
        title: 'Не удалось удалить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    }
  };

  const filtered = employees.filter((e) => {
    if (roleFilter !== 'all' && e.role !== roleFilter) return false;
    if (workshopFilter !== 'all' && (e.workshop || '') !== workshopFilter) return false;
    return true;
  });

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Пользователи</h1>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
                <Icon name="Plus" size={16} className="mr-1.5" />
                Добавить сотрудника
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Новый сотрудник</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-14 w-14">
                    {createForm.avatarBase64 && <AvatarImage src={createForm.avatarBase64} />}
                    <AvatarFallback>
                      {createForm.fullName ? initials(createForm.fullName) : <Icon name="User" size={20} />}
                    </AvatarFallback>
                  </Avatar>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => createFileRef.current?.click()}
                  >
                    Загрузить аватар
                  </Button>
                  <input
                    ref={createFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const base64 = await readFileAsBase64(file);
                      setCreateForm((f) => ({ ...f, avatarBase64: base64 }));
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Имя</Label>
                  <Input
                    placeholder="ФИО"
                    value={createForm.fullName}
                    onChange={(e) => setCreateForm((f) => ({ ...f, fullName: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    placeholder="employee@cpanel.su"
                    value={createForm.email}
                    onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Логин для входа будет создан автоматически из email
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Роль</Label>
                    <Select
                      value={createForm.role}
                      onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v as Role }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roleOptions.map((r) => (
                          <SelectItem key={r} value={r}>
                            {roleLabels[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Цех</Label>
                    <Select
                      value={createForm.workshop || 'none'}
                      onValueChange={(v) => setCreateForm((f) => ({ ...f, workshop: v === 'none' ? '' : v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {workshopOptions.map((w) => (
                          <SelectItem key={w} value={w}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Пароль</Label>
                  <Input
                    type="text"
                    placeholder="Минимум 6 символов"
                    value={createForm.password}
                    onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
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
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все роли</SelectItem>
              {roleOptions.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabels[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все цеха</SelectItem>
              {workshopOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сотрудников пока нет.</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Аватар</TableHead>
                  <TableHead className="text-primary-foreground">Имя</TableHead>
                  <TableHead className="text-primary-foreground">Роль</TableHead>
                  <TableHead className="text-primary-foreground">Цех</TableHead>
                  <TableHead className="text-primary-foreground">Email / Телефон</TableHead>
                  <TableHead className="text-primary-foreground">Создан</TableHead>
                  <TableHead className="text-primary-foreground">Обновлен</TableHead>
                  <TableHead className="text-primary-foreground">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp) => (
                  <TableRow
                    key={emp.id}
                    className="cursor-pointer"
                    onClick={() => openCard(emp)}
                  >
                    <TableCell>{emp.id}</TableCell>
                    <TableCell>
                      <Avatar className="h-9 w-9">
                        {emp.avatarUrl && <AvatarImage src={emp.avatarUrl} />}
                        <AvatarFallback className="text-xs">{initials(emp.fullName)}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">
                      <div>{emp.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        Логин: <span className="font-mono-tech">{emp.login}</span>
                      </div>
                    </TableCell>
                    <TableCell>{roleLabels[emp.role]}</TableCell>
                    <TableCell>{emp.workshop || '—'}</TableCell>
                    <TableCell>
                      <div>{emp.email}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(emp.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(emp.updatedAt)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <Button size="icon" variant="secondary" onClick={() => openCard(emp)}>
                          <Icon name="Pencil" size={14} />
                        </Button>
                        <Button size="icon" variant="destructive" onClick={() => setDeleteId(emp.id)}>
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

      <Dialog open={cardEmployee !== null} onOpenChange={(open) => !open && closeCard()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Карточка сотрудника</DialogTitle>
          </DialogHeader>

          {cardForm && cardEmployee && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-16 w-16">
                  {(cardForm.avatarBase64 || cardEmployee.avatarUrl) && (
                    <AvatarImage src={cardForm.avatarBase64 || cardEmployee.avatarUrl || ''} />
                  )}
                  <AvatarFallback>{initials(cardEmployee.fullName)}</AvatarFallback>
                </Avatar>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => cardFileRef.current?.click()}
                  >
                    Сменить аватар
                  </Button>
                </div>
                <input
                  ref={cardFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const base64 = await readFileAsBase64(file);
                    setCardForm((f) => f && { ...f, avatarBase64: base64 });
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2">
                <div>
                  <p className="text-xs text-muted-foreground">Логин для входа</p>
                  <p className="font-mono-tech text-sm font-semibold">{cardEmployee.login}</p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(cardEmployee.login);
                    toast({ title: 'Логин скопирован' });
                  }}
                >
                  <Icon name="Copy" size={14} />
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label>Имя</Label>
                <Input
                  value={cardForm.fullName}
                  onChange={(e) => setCardForm((f) => f && { ...f, fullName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Роль</Label>
                  <Select
                    value={cardForm.role}
                    onValueChange={(v) => setCardForm((f) => f && { ...f, role: v as Role })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabels[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Цех</Label>
                  <Select
                    value={cardForm.workshop || 'none'}
                    onValueChange={(v) => setCardForm((f) => f && { ...f, workshop: v === 'none' ? '' : v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {workshopOptions.map((w) => (
                        <SelectItem key={w} value={w}>
                          {w}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Заработная плата, ₽</Label>
                <Input
                  type="number"
                  min={0}
                  value={cardForm.salary}
                  onChange={(e) => setCardForm((f) => f && { ...f, salary: e.target.value })}
                />
              </div>

              <div>
                <Label>График — когда можно открыть смену</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">С</Label>
                    <Input
                      type="time"
                      value={cardForm.shiftFrom}
                      onChange={(e) => setCardForm((f) => f && { ...f, shiftFrom: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">До</Label>
                    <Input
                      type="time"
                      value={cardForm.shiftTo}
                      onChange={(e) => setCardForm((f) => f && { ...f, shiftTo: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Новый пароль</Label>
                <Input
                  type="text"
                  placeholder="Оставьте пустым, чтобы не менять"
                  value={cardForm.newPassword}
                  onChange={(e) => setCardForm((f) => f && { ...f, newPassword: e.target.value })}
                />
              </div>

              <Button
                onClick={handleCardSave}
                disabled={cardSaving}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {cardSaving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сотрудника?</AlertDialogTitle>
            <AlertDialogDescription>Доступ в систему будет отозван.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default UsersSettings;