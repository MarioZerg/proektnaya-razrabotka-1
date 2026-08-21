import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { contractFileUrl, fetchMyContracts, type Contract } from '@/lib/contractsApi';
import SignContractDialog from '@/components/crm/contracts/SignContractDialog';

interface ContractGateProps {
  /** Вызывается, когда все документы подписаны — каркас снова показывает систему. */
  onAllSigned: () => void;
}

/** Экран-заслонка: пока у сотрудника есть неподписанные документы, работать в системе
 * нельзя. Показываем список документов и даём подписать их кодом из MAX. */
const ContractGate = ({ onAllSigned }: ContractGateProps) => {
  const { user, logout } = useAuth();
  const [items, setItems] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<Contract | null>(null);

  const load = () => {
    if (!user) return;
    setLoading(true);
    fetchMyContracts(user.id)
      .then((list) => {
        const pending = list.filter((c) => c.status === 'pending');
        setItems(pending);
        if (pending.length === 0) onAllSigned();
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg space-y-5">
        <div className="text-center">
          <Icon name="FileSignature" size={48} className="mx-auto text-primary" />
          <h1 className="mt-3 text-xl font-bold">Подпишите документы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Чтобы продолжить работу в системе, ознакомьтесь с документами и подпишите их
            кодом из MAX
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка документов...
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((c) => (
              <div key={c.id} className="rounded-md border border-border p-4">
                <p className="font-semibold">{c.title}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={contractFileUrl(c.id, user?.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Icon name="FileText" size={14} className="mr-1.5" />
                      Прочитать
                    </a>
                  </Button>
                  <Button size="sm" onClick={() => setSigning(c)}>
                    <Icon name="PenLine" size={14} className="mr-1.5" />
                    Подписать
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={logout}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Выйти из системы
        </button>

        {user && (
          <SignContractDialog
            contract={signing}
            userId={user.id}
            onOpenChange={(v) => !v && setSigning(null)}
            onSigned={load}
          />
        )}
      </div>
    </div>
  );
};

export default ContractGate;