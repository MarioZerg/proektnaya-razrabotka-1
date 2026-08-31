import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Employee } from '@/lib/usersApi';

interface ArchiveEmployeeDialogProps {
  employee: Employee | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  saving: boolean;
}

/**
 * Увольнение сотрудника. Вместо удаления — перевод в архив: история работы
 * сохраняется целиком, поэтому по любой вещи всегда видно, кто её шил.
 */
const ArchiveEmployeeDialog = ({
  employee,
  onOpenChange,
  onConfirm,
  saving,
}: ArchiveEmployeeDialogProps) => {
  const [reason, setReason] = useState('');

  return (
    <AlertDialog
      open={employee !== null}
      onOpenChange={(open) => {
        if (!open) setReason('');
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Уволить {employee?.fullName}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Сотрудник уйдёт в архив: пропадёт из списков и не сможет войти в систему.</p>
              <p>
                Вся история работы сохранится — смены, начисления и сшитые вещи. По каждой
                вещи по-прежнему будет видно, кто её сшил.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="archive-reason">Причина увольнения</Label>
          <Textarea
            id="archive-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например: уволен по собственному желанию"
            rows={3}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Диалог закрывается сам по клику — но нам нужно сначала отправить
              // запрос, поэтому закрытие берём на себя после ответа сервера.
              e.preventDefault();
              onConfirm(reason);
            }}
            disabled={saving}
          >
            {saving ? 'Увольняем…' : 'Уволить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ArchiveEmployeeDialog;
