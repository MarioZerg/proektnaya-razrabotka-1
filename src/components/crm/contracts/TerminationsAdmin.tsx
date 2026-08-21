import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  confirmTermination,
  fetchPendingTerminations,
  rejectTermination,
  type PendingTermination,
} from '@/lib/terminationApi';

const roleLabels: Record<string, string> = {
  sewer: 'Швея',
  cutter: 'Закройщик',
  packer: 'Упаковщик',
  storekeeper: 'Кладовщик',
  senior_storekeeper: 'Ст. кладовщик',
  cleaner: 'Уборщица',
  manager: 'Менеджер',
};

/** «4 сентября 2026» — без «г.» на конце: рядом в тексте и так стоит точка. */
const formatDate = (v: string) =>
  new Date(v)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .replace(' г.', '');

/**
 * Заявления о расторжении, которые ждут решения администратора.
 *
 * Сотрудник уже подписал Акт кодом из MAX — здесь администратор либо
 * подтверждает (доступ закрывается, аккаунт остаётся), либо отклоняет с
 * причиной: например, если за человеком числятся невозвращённые материалы.
 */
const TerminationsAdmin = ({ onChanged }: { onChanged?: () => void }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<PendingTermination[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<PendingTermination | null>(null);
  const [confirming, setConfirming] = useState<PendingTermination | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    if (!user?.id) return;
    fetchPendingTerminations(user.id).then(setItems).catch(() => setItems([]));
  }, [user?.id]);

  useEffect(() => load(), [load]);

  if (items.length === 0) return null;

  const doConfirm = async () => {
    setBusy(true);
    try {
      await confirmTermination(confirming!.id, user!.id);
      toast({
        title: 'Расторжение подтверждено',
        description: `${confirming!.fullName} — доступ закрыт, аккаунт сохранён`,
      });
      setConfirming(null);
      load();
      onChanged?.();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    setBusy(true);
    try {
      await rejectTermination(rejecting!.id, user!.id, reason);
      toast({ title: 'Заявление отклонено', description: 'Сотрудник получит уведомление' });
      setRejecting(null);
      setReason('');
      load();
      onChanged?.();
    } catch (e) {
      toast({
        title: 'Не удалось отклонить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <p className="flex items-center gap-2 font-semibold text-destructive">
        <Icon name="CircleAlert" size={17} />
        Расторжение договора: {items.length}
      </p>
      <p className="text-xs text-muted-foreground">
        Сотрудник подписал Акт. Подтвердите — доступ закроется, аккаунт и история
        расчётов сохранятся
      </p>

      {items.map((t) => (
        <div
          key={t.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3"
        >
          <div className="min-w-0">
            <p className="font-medium">{t.fullName}</p>
            <p className="text-xs text-muted-foreground">
              {roleLabels[t.role] || t.role} · договор прекращается{' '}
              {formatDate(t.terminationDate)}
              {t.signedAt && ` · подписано ${formatDate(t.signedAt)}`}
            </p>
            {t.reason && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Причина: {t.reason}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirming(t)} disabled={busy}>
              <Icon name="Check" size={14} className="mr-1.5" />
              Подтвердить
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejecting(t)}
              disabled={busy}
            >
              <Icon name="X" size={14} className="mr-1.5" />
              Отклонить
            </Button>
          </div>
        </div>
      ))}

      <AlertDialog open={!!confirming} onOpenChange={(v) => !v && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить расторжение?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <b>{confirming?.fullName}</b> — договор прекращается{' '}
                  {confirming && formatDate(confirming.terminationDate)}.
                </p>
                <p>
                  Доступ в систему закроется сразу, открытая смена закроется.
                  Аккаунт и вся история работы сохранятся — заработанное нужно
                  досчитать и выплатить.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={doConfirm} disabled={busy}>
              Подтвердить и закрыть доступ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отклонить заявление?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Сотрудник увидит причину и получит уведомление в MAX. Он сможет
                  подать заявление заново.
                </p>
                <div className="space-y-1.5 text-left">
                  <Label className="text-xs">Причина отказа</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                    placeholder="Например: не возвращён рулон тесьмы №2-004678"
                    rows={3}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={doReject} disabled={busy || !reason.trim()}>
              Отклонить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TerminationsAdmin;
