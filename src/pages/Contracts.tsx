import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/dateUtils';
import {
  fetchAllContracts,
  fetchMyContracts,
  cancelContract,
  type Contract,
} from '@/lib/contractsApi';
import SignContractDialog from '@/components/crm/contracts/SignContractDialog';
import UploadContractDialog from '@/components/crm/contracts/UploadContractDialog';
import PersonalDataPanel from '@/components/crm/personal/PersonalDataPanel';

const statusInfo: Record<Contract['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Ждёт подписи', variant: 'destructive' },
  signed: { label: 'Подписан', variant: 'secondary' },
  cancelled: { label: 'Отозван', variant: 'outline' },
};

/** Договоры: сотрудник видит свои документы и подписывает их кодом из MAX,
 * администратор — документы всех и направляет новые на подпись. */
const Contracts = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<Contract | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = () => {
    if (!user) return;
    setLoading(true);
    (isAdmin ? fetchAllContracts(user.id) : fetchMyContracts(user.id))
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isAdmin]);

  const handleCancel = async (id: number) => {
    try {
      await cancelContract(id);
      toast({ title: 'Документ отозван' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отозвать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Договоры</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? 'Документы сотрудников и направление новых на подпись'
                : 'Ваши документы — подписываются кодом из MAX'}
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setUploadOpen(true)}>
              <Icon name="Plus" size={16} className="mr-1.5" />
              Направить на подпись
            </Button>
          )}
        </div>

        {isAdmin && (
          <Card className="border-border shadow-none">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-start gap-3">
                <Icon name="FileSignature" size={22} className="mt-0.5 shrink-0 text-primary" />
                <div>
                  <p className="font-bold">Договор соберётся сам</p>
                  <p className="text-sm text-muted-foreground">
                    Для швеи, закройщика, кладовщика и упаковщицы система формирует
                    договор по должности и сама подставляет паспортные данные и
                    реквизиты. Откройте карточку сотрудника, проверьте данные и
                    отправьте на подпись
                  </p>
                </div>
              </div>
              <Button variant="outline" asChild>
                <a href="/crm/settings/users">
                  <Icon name="Users" size={16} className="mr-1.5" />
                  К сотрудникам
                </a>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Свои документы и реквизиты сотрудник заполняет здесь же: отдельного личного
            кабинета в системе нет, а договор без сканов и номера для выплат оформить
            нельзя. Админ те же данные видит в карточке сотрудника. */}
        {!isAdmin && user && (
          <PersonalDataPanel userId={user.id} actorId={user.id} isAdmin={false} />
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-10 text-center">
            <Icon name="FileText" size={40} className="mx-auto text-muted-foreground" />
            <p className="mt-3 font-semibold">Документов пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? 'Направьте сотруднику документ на подпись'
                : 'Когда администратор направит документ, он появится здесь'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((c) => (
              <div key={c.id} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{c.title}</p>
                    {isAdmin && (
                      <p className="text-sm text-muted-foreground">{c.userName}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Направлен {formatDateTime(c.createdAt)}
                      {c.signedAt && ` · подписан ${formatDateTime(c.signedAt)}`}
                      {c.signedPhone && ` · ${c.signedPhone}`}
                    </p>
                  </div>
                  <Badge variant={statusInfo[c.status].variant}>
                    {statusInfo[c.status].label}
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={c.fileUrl} target="_blank" rel="noreferrer">
                      <Icon name="FileText" size={14} className="mr-1.5" />
                      Открыть документ
                    </a>
                  </Button>

                  {!isAdmin && c.status === 'pending' && (
                    <Button size="sm" onClick={() => setSigning(c)}>
                      <Icon name="PenLine" size={14} className="mr-1.5" />
                      Подписать
                    </Button>
                  )}

                  {isAdmin && c.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleCancel(c.id)}
                    >
                      <Icon name="X" size={14} className="mr-1.5" />
                      Отозвать
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {user && (
          <SignContractDialog
            contract={signing}
            userId={user.id}
            onOpenChange={(v) => !v && setSigning(null)}
            onSigned={load}
          />
        )}

        <UploadContractDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onDone={load}
          actorId={user?.id}
          actorName={user?.name}
        />
      </div>
    </CrmLayout>
  );
};

export default Contracts;