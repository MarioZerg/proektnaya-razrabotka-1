import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';

interface PendingApprovalScreenProps {
  roles: Role[];
  onLogout: () => void;
}

const PendingApprovalScreen = ({ roles, onLogout }: PendingApprovalScreenProps) => (
  <div className="space-y-4 text-center">
    <div className="flex justify-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-500/10 text-amber-600">
        <Icon name="Clock" size={22} />
      </div>
    </div>
    <div>
      <h2 className="text-base font-semibold">Ждём подтверждения администратора</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {roles.length > 0
          ? `Вы выбрали должность «${roles.map((r) => roleLabels[r]).join('», «')}» — как только администратор подтвердит её, вы получите доступ к разделам системы.`
          : 'Как только администратор утвердит вашу должность, вы получите доступ к разделам системы.'}
      </p>
    </div>
    <Button variant="outline" className="w-full" onClick={onLogout}>
      Выйти
    </Button>
  </div>
);

export default PendingApprovalScreen;
