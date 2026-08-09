import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { fetchPersonalData, type DocsStatus } from '@/lib/personalDataApi';

/** Склонение: 1 день, 2 дня, 5 дней. */
const daysWord = (n: number) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
};

/** Счётчик до окончания срока на документы. Висит вверху системы, пока сотрудник
 * не сдаст комплект. Когда документы уходят на проверку — счётчик замирает и
 * превращается в спокойное «на проверке»: человек свою часть выполнил. */
const DocsCountdownBanner = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<DocsStatus | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchPersonalData(user.id, user.id)
      .then((d) => {
        setStatus(d.docsStatus);
        setReason(d.docsRejectedReason);
      })
      .catch(() => setStatus(null));
  }, [user?.id]);

  // Проверено, срок не назначен или человек уже заблокирован (там своя заслонка) —
  // показывать нечего.
  if (!status || status.state === 'done' || status.state === 'none') return null;
  if (status.state === 'blocked') return null;

  if (status.state === 'review') {
    return (
      <div className="flex items-start gap-2.5 border-b border-border bg-muted/60 px-4 py-2.5">
        <Icon name="Clock" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Документы загружены и ждут проверки администратором. От вас больше ничего
          не требуется
        </p>
      </div>
    );
  }

  const days = status.daysLeft ?? 0;
  const urgent = days <= 2;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 ${
        urgent
          ? 'border-destructive/40 bg-destructive/10'
          : 'border-amber-300 bg-amber-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          name={urgent ? 'TriangleAlert' : 'Clock'}
          size={16}
          className={`mt-0.5 shrink-0 ${urgent ? 'text-destructive' : 'text-amber-600'}`}
        />
        <div>
          <p
            className={`text-sm font-medium ${
              urgent ? 'text-destructive' : 'text-amber-900'
            }`}
          >
            {days > 0
              ? `Загрузите документы: остал${days === 1 ? 'ся' : 'ось'} ${days} ${daysWord(days)}`
              : 'Сегодня последний день для загрузки документов'}
          </p>
          <p className={`text-xs ${urgent ? 'text-destructive' : 'text-amber-900'}`}>
            {reason
              ? `Документы отклонены: ${reason}`
              : 'Паспорт, прописка и СНИЛС. Без них доступ к системе будет приостановлен'}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={urgent ? 'destructive' : 'outline'}
        onClick={() => navigate('/crm/contracts')}
      >
        Загрузить
      </Button>
    </div>
  );
};

export default DocsCountdownBanner;
