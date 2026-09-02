import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { fetchTestAccounts, type TestAccount } from '@/lib/authApi';
import { roleLabels } from '@/lib/roles';

const roleIcons: Record<TestAccount['role'], string> = {
  admin: 'ShieldCheck',
  storekeeper: 'Warehouse',
  senior_storekeeper: 'Star',
  sewer: 'Shirt',
  cutter: 'Scissors',
  packer: 'PackageCheck',
  cleaner: 'Sparkles',
  manager: 'Briefcase',
};

interface TestAccountsPanelProps {
  onSelect: (account: TestAccount) => void;
  disabled?: boolean;
}

const TestAccountsPanel = ({ onSelect, disabled }: TestAccountsPanelProps) => {
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTestAccounts()
      .then(setAccounts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка тестовых аккаунтов...
      </div>
    );
  }

  if (accounts.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(acc)}
            className="flex flex-col items-center gap-1.5 rounded-sm border border-border bg-transparent px-3 py-3 text-center transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <Icon name={roleIcons[acc.role] || 'User'} size={20} className="text-muted-foreground" />
            <span className="text-xs font-medium leading-tight">{roleLabels[acc.role]}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TestAccountsPanel;