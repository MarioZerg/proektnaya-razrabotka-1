import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';

interface KioskPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminName: string;
}

/** Роли, которые реально работают за терминалом цеха. Администратор и менеджер в киоск не
 * ходят, но админу нужно видеть терминал их глазами — поэтому список именно рабочий. */
const KIOSK_ROLES: Role[] = ['sewer', 'cutter', 'packer', 'storekeeper'];

/**
 * Вход администратора в терминал цеха для проверки: он выбирает цех и роль и попадает в киоск
 * так, как его видит сотрудник этой должности. Реальная смена при этом не открывается —
 * это режим просмотра, ничего в отчёты не пишется.
 */
const KioskPreviewDialog = ({ open, onOpenChange, adminName }: KioskPreviewDialogProps) => {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopId, setWorkshopId] = useState('');
  const [role, setRole] = useState<Role>('sewer');

  useEffect(() => {
    if (!open) return;
    fetchWorkshops()
      .then((list) => {
        setWorkshops(list);
        if (list.length > 0) setWorkshopId((prev) => prev || String(list[0].id));
      })
      .catch(() => setWorkshops([]));
  }, [open]);

  const handleOpen = () => {
    if (!workshopId) return;
    const params = new URLSearchParams({
      preview: '1',
      role,
      name: adminName,
    });
    window.open(`/kiosk/${workshopId}?${params.toString()}`, '_blank');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Открыть терминал цеха для проверки</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Терминал откроется в новой вкладке так, как его видит выбранная должность. Смена не
            открывается, отчёты не меняются — это режим просмотра.
          </p>

          <div className="space-y-1.5">
            <Label>Цех</Label>
            <Select value={workshopId} onValueChange={setWorkshopId}>
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
            <Label>Смотреть глазами</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIOSK_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button className="w-full" onClick={handleOpen} disabled={!workshopId}>
            <Icon name="MonitorPlay" size={16} className="mr-2" />
            Открыть терминал
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskPreviewDialog;
