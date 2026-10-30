import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { revealCronSecret } from '@/lib/schedulerStatusApi';

/** Сколько секунд ключ виден на экране, потом прячется сам. */
const SHOW_SECONDS = 60;

interface Props {
  /** Ключ получен — отдаём наверх, чтобы карточки подставили его в ссылки. */
  onSecret: (secret: string | null) => void;
}

/**
 * Ключ запуска фоновых заданий — только по нажатию.
 *
 * Сервер выдаёт его лишь администратору, не чаще 5 раз за 10 минут, и каждый
 * показ попадает в журнал и в уведомления. На экране ключ замазан, виден
 * минуту и прячется сам — подсмотреть через плечо или забыть открытым нельзя.
 */
const CronSecretPanel = ({ onSecret }: Props) => {
  const { toast } = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const hide = () => {
    setVisible(false);
    setSecret(null);
    onSecret(null);
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  const reveal = async () => {
    setBusy(true);
    try {
      const s = await revealCronSecret();
      setSecret(s);
      setVisible(true);
      onSecret(s);
      setLeft(SHOW_SECONDS);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        setLeft((v) => {
          if (v <= 1) {
            hide();
            return 0;
          }
          return v - 1;
        });
      }, 1000);
    } catch (e) {
      toast({
        title: 'Ключ не показан',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast({ title: 'Ключ скопирован' });
    } catch {
      toast({ title: 'Не удалось скопировать', description: 'Выделите ключ и скопируйте вручную', variant: 'destructive' });
    }
  };

  return (
    <Card className="border-amber-300 bg-amber-50 shadow-none">
      <CardContent className="space-y-2 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="KeyRound" size={18} className="text-amber-700" />
            <span className="font-semibold">Ключ планировщика (CRON_SECRET)</span>
          </div>
          {visible ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copy}>
                <Icon name="Copy" size={14} className="mr-1" />
                Копировать
              </Button>
              <Button size="sm" variant="outline" onClick={hide}>
                <Icon name="EyeOff" size={14} className="mr-1" />
                Скрыть
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={reveal} disabled={busy}>
              <Icon name={busy ? 'Loader2' : 'Eye'} size={14} className={`mr-1 ${busy ? 'animate-spin' : ''}`} />
              Показать ключ
            </Button>
          )}
        </div>

        <p className="break-all rounded border bg-background px-2 py-1 font-mono-tech text-sm">
          {visible && secret ? secret : '••••••••••••••••••••••••••••••••'}
        </p>

        <p className="text-xs text-muted-foreground">
          {visible
            ? `Спрячется через ${left} с. Пока ключ открыт, он подставлен в адреса заданий ниже.`
            : 'Ключ вставляется в команду после cronSecret=. Показ видит только администратор, каждый показ записывается в журнал и приходит уведомлением.'}
        </p>
      </CardContent>
    </Card>
  );
};

export default CronSecretPanel;
