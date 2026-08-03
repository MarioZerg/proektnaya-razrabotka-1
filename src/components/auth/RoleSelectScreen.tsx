import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';

const roleIcons: Record<Role, string> = {
  admin: 'ShieldCheck',
  storekeeper: 'Warehouse',
  sewer: 'Shirt',
  cutter: 'Scissors',
  packer: 'PackageCheck',
  cleaner: 'Sparkles',
  manager: 'Briefcase',
};

interface RoleSelectScreenProps {
  title: string;
  description: string;
  roles: Role[];
  disabled?: boolean;
  onSelect: (role: Role) => void;
}

const RoleSelectScreen = ({ title, description, roles, disabled, onSelect }: RoleSelectScreenProps) => (
  <div className="space-y-4 text-center">
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {roles.map((role) => (
        <button
          key={role}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(role)}
          className="flex flex-col items-center gap-1.5 rounded-sm border border-border bg-transparent px-3 py-3 text-center transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
        >
          <Icon name={roleIcons[role] || 'User'} size={20} className="text-muted-foreground" />
          <span className="text-xs font-medium leading-tight">{roleLabels[role]}</span>
        </button>
      ))}
    </div>
  </div>
);

export default RoleSelectScreen;