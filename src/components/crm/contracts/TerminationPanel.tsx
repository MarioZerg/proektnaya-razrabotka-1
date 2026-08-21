import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  cancelTermination,
  fetchTerminationState,
  requestTermination,
  sendTerminationCode,
  signTermination,
  type TerminationState,
} from '@/lib/terminationApi';

/** «4 сентября 2026» — без «г.» на конце: рядом в тексте и так стоит точка. */
const formatDate = (v: string) =>
  new Date(v)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .replace(' г.', '');

/**
 * Расторжение договора в личном кабинете сотрудника.
 *
 * Кнопка не «уволиться одним нажатием»: человек подаёт заявление, читает Акт и
 * подписывает его кодом из MAX — так же, как подписывал сам договор. Дату
 * прекращения система ставит сама, через 14 дней (п. 5.2 договора), выбрать
 * раньше нельзя. Пока за сотрудником числится незакрытая работа, заявление не
 * принимается: по п. 5.3 принятые задания нужно завершить.
 */
const TerminationPanel = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [state, setState] = useState<TerminationState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!user?.id) return;
    fetchTerminationState(user.id).then(setState).catch(() => setState(null));
  }, [user?.id]);

  useEffect(() => load(), [load]);

  if (!state || user?.role === 'admin') return null;

  const cur = state.current;
  const active =
    cur && (cur.status === 'pending_sign' || cur.status === 'pending_admin');

  const handleRequest = async () => {
    setBusy(true);
    try {
      await requestTermination(user!.id, reason);
      toast({
        title: 'Заявление создано',
        description: 'Осталось подписать Акт кодом из MAX',
      });
      setConfirmOpen(false);
      setReason('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось подать заявление',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSendCode = async () => {
    setBusy(true);
    try {
      await sendTerminationCode(cur!.id, user!.id);
      toast({ title: 'Код отправлен в MAX', description: 'Действует 15 минут' });
    } catch (e) {
      toast({
        title: 'Не удалось отправить код',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSign = async () => {
    setBusy(true);
    try {
      await signTermination(cur!.id, user!.id, code);
      toast({
        title: 'Акт подписан',
        description: 'Заявление ушло администратору на подтверждение',
      });
      setCode('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось подписать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelTermination(cur!.id, user!.id);
      toast({ title: 'Заявление отозвано' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отозвать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  // Заявление подписано и ждёт администратора.
  if (cur?.status === 'pending_admin') {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <p className="flex items-center gap-2 font-semibold text-amber-900">
          <Icon name="Clock" size={16} />
          Расторжение на рассмотрении
        </p>
        <p className="mt-1 text-sm text-amber-900">
          Акт подписан {cur.signedAt ? formatDate(cur.signedAt) : ''}. Договор
          прекращает действие {formatDate(cur.terminationDate)} — до этой даты
          нужно завершить принятые заказы и вернуть материалы.
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Заработанное будет выплачено в обычные сроки: прекращение доступа не
          отменяет расчётов
        </p>
      </div>
    );
  }

  // Заявление создано, ждёт подписи.
  if (cur?.status === 'pending_sign') {
    return (
      <div className="rounded-lg border border-border p-4">
        <p className="font-semibold">Акт о расторжении договора</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Договор прекратит действие {formatDate(cur.terminationDate)} — через 14
          дней, как требует пункт 5.2 договора. Подпишите Акт кодом из MAX.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Button variant="outline" size="sm" onClick={handleSendCode} disabled={busy}>
            <Icon name="Send" size={14} className="mr-1.5" />
            Получить код в MAX
          </Button>
          <div className="w-36 space-y-1.5">
            <Label className="text-xs">Код из MAX</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
            />
          </div>
          <Button size="sm" onClick={handleSign} disabled={busy || code.length < 6}>
            <Icon name="PenLine" size={14} className="mr-1.5" />
            Подписать Акт
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={busy}>
            Передумал
          </Button>
        </div>
      </div>
    );
  }

  // Администратор отклонил — показываем причину.
  if (cur?.status === 'rejected') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <p className="flex items-center gap-2 font-semibold text-destructive">
          <Icon name="TriangleAlert" size={16} />
          Заявление о расторжении отклонено
        </p>
        <p className="mt-1 text-sm">Причина: {cur.rejectReason}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Решите вопрос с администратором — после этого можно подать заявление
          заново
        </p>
      </div>
    );
  }

  if (active) return null;

  const blocked = state.unfinishedOrders.length > 0;

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="font-semibold">Расторжение договора</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Если решили прекратить работу — подайте заявление. По договору
        предупредить нужно за {state.noticeDays} дней: договор прекратится{' '}
        {formatDate(state.plannedDate)}.
      </p>

      {blocked ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Сначала завершите работу — {state.unfinishedOrders.length} заказов не
            сдано
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            По договору принятые задания нужно закончить. Сдайте их и возвращайтесь
          </p>
          <div className="mt-2 space-y-0.5">
            {state.unfinishedOrders.slice(0, 5).map((o) => (
              <p key={o.id} className="text-xs text-amber-900">
                {o.title} · {o.orderNumber} — {o.status}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
        >
          <Icon name="FileX" size={14} className="mr-1.5" />
          Расторгнуть договор
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Расторгнуть договор?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Договор прекратит действие{' '}
                  <b>{formatDate(state.plannedDate)}</b> — через {state.noticeDays}{' '}
                  дней, как требует пункт 5.2 договора. До этой даты нужно
                  завершить принятые заказы и вернуть материалы.
                </p>
                <p>
                  Заработанное выплачивается в обычные сроки — расторжение не
                  отменяет расчётов.
                </p>
                <div className="space-y-1.5 text-left">
                  <Label className="text-xs">Причина (необязательно)</Label>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, 500))}
                    placeholder="Например: переезд, смена работы"
                    rows={2}
                  />
                </div>
                <p className="text-xs">
                  После этого нужно будет подписать Акт кодом из MAX
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleRequest} disabled={busy}>
              Подать заявление
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TerminationPanel;
