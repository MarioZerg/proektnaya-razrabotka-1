import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { fetchPersonalData, type PersonalData } from '@/lib/personalDataApi';
import DocumentsSection from '@/components/crm/personal/DocumentsSection';

interface DocsGateProps {
  /** Вызывается, когда сотрудник догрузил комплект — каркас пускает его в систему. */
  onSubmitted: () => void;
}

/** Экран-заслонка: срок на загрузку документов вышел, комплекта нет.
 *
 * Отсюда сотрудник может догрузить сканы, но вернуть его в работу может только
 * администратор — так требование не превращается в формальность, которую
 * закрывают в последний момент кое-как. */
const DocsGate = ({ onSubmitted }: DocsGateProps) => {
  const { user, logout } = useAuth();
  const [data, setData] = useState<PersonalData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!user) return;
    setLoading(true);
    fetchPersonalData(user.id, user.id)
      .then((d) => {
        setData(d);
        // Админ снял блокировку — сразу возвращаем человека в систему.
        if (!d.docsStatus.blocked) onSubmitted();
      })
      .finally(() => setLoading(false));
  }, [user, onSubmitted]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;

  const uploadedCount = data?.documents.length ?? 0;
  const totalCount = data?.requiredDocs.length ?? 3;
  const complete = uploadedCount >= totalCount;

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <Icon
              name="ShieldAlert"
              size={26}
              className="mt-0.5 shrink-0 text-destructive"
            />
            <div>
              <h1 className="text-lg font-bold text-destructive">
                Доступ приостановлен
              </h1>
              <p className="mt-1 text-sm text-destructive">
                Документы не были загружены в отведённый срок. Работать в системе
                пока нельзя.
              </p>
            </div>
          </div>
        </div>

        {data?.docsRejectedReason && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="font-medium text-amber-900">Что было не так</p>
            <p className="mt-1 text-sm text-amber-900">{data.docsRejectedReason}</p>
          </div>
        )}

        <div className="rounded-lg border border-border bg-background p-5">
          <p className="font-bold">Что делать</p>
          <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>1. Загрузите все документы ниже — снимайте при хорошем свете.</li>
            <li>2. Сообщите руководителю, что документы загружены.</li>
            <li>
              3. Администратор проверит их и вернёт вам доступ. Сделать это
              самостоятельно нельзя.
            </li>
          </ol>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : data ? (
          <div className="rounded-lg bg-background">
            <DocumentsSection
              data={data}
              userId={user.id}
              actorId={user.id}
              isAdmin={false}
              onChanged={load}
            />
          </div>
        ) : null}

        {complete && (
          <div className="flex items-start gap-2.5 rounded-md border border-emerald-300 bg-emerald-50 p-4">
            <Icon
              name="CircleCheck"
              size={20}
              className="mt-0.5 shrink-0 text-emerald-600"
            />
            <p className="text-sm text-emerald-900">
              Все документы загружены. Сообщите руководителю — он проверит их и
              вернёт доступ к системе
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load}>
            <Icon name="RefreshCw" size={16} className="mr-1.5" />
            Проверить доступ
          </Button>
          <Button variant="ghost" onClick={logout}>
            <Icon name="LogOut" size={16} className="mr-1.5" />
            Выйти
          </Button>
        </div>
      </div>
    </div>
  );
};

export default DocsGate;
