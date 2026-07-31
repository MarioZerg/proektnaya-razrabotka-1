import { Dispatch, RefObject, SetStateAction } from 'react';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import {
  initials,
  readFileAsBase64,
  roleOptions,
  workshopOptions,
  type CreateFormState,
} from '@/components/crm/users/usersShared';

interface CreateEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggerClick: () => void;
  createForm: CreateFormState;
  setCreateForm: Dispatch<SetStateAction<CreateFormState>>;
  creating: boolean;
  onCreate: () => void;
  createFileRef: RefObject<HTMLInputElement>;
}

const CreateEmployeeDialog = ({
  open,
  onOpenChange,
  onTriggerClick,
  createForm,
  setCreateForm,
  creating,
  onCreate,
  createFileRef,
}: CreateEmployeeDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button onClick={onTriggerClick} className="bg-blue-600 text-white hover:bg-blue-700">
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
            onClick={onCreate}
            disabled={creating}
            className="w-full bg-blue-600 text-white hover:bg-blue-700"
          >
            {creating ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Создать'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateEmployeeDialog;
