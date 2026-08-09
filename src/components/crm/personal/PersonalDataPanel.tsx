import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { fetchPersonalData, type PersonalData } from '@/lib/personalDataApi';
import DocumentsSection from '@/components/crm/personal/DocumentsSection';
import SbpSection from '@/components/crm/personal/SbpSection';
import PassportSection from '@/components/crm/personal/PassportSection';
import GenerateContractPanel from '@/components/crm/personal/GenerateContractPanel';
import type { Role } from '@/lib/roles';

interface PersonalDataPanelProps {
  /** Чьи данные показываем. */
  userId: number;
  /** Кто смотрит — от этого зависит, видны ли сканы и паспортные поля. */
  actorId: number;
  isAdmin: boolean;
  /** Должность сотрудника — по ней подбирается шаблон договора. */
  role?: Role;
  /** Вызывается после отправки договора, чтобы обновить список документов. */
  onContractSent?: () => void;
}

/** Документы и данные сотрудника: сканы, реквизиты для выплат и — у админа —
 * паспортные поля с формированием договора. */
const PersonalDataPanel = ({
  userId,
  actorId,
  isAdmin,
  role,
  onContractSent,
}: PersonalDataPanelProps) => {
  const [data, setData] = useState<PersonalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetchPersonalData(userId, actorId)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить'))
      .finally(() => setLoading(false));
  }, [userId, actorId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка данных...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {error || 'Данные недоступны'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DocumentsSection
        data={data}
        userId={userId}
        actorId={actorId}
        isAdmin={isAdmin}
        onChanged={load}
      />

      <SbpSection
        data={data}
        userId={userId}
        actorId={actorId}
        isAdmin={isAdmin}
        onChanged={load}
      />

      {isAdmin && (
        <>
          <PassportSection
            data={data}
            userId={userId}
            actorId={actorId}
            onChanged={load}
          />
          <GenerateContractPanel
            data={data}
            userId={userId}
            actorId={actorId}
            role={role}
            onSent={() => {
              load();
              onContractSent?.();
            }}
          />
        </>
      )}
    </div>
  );
};

export default PersonalDataPanel;
