import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  contractFileUrl,
  sendSignCode,
  signContract,
  type Contract,
} from '@/lib/contractsApi';

interface SignContractDialogProps {
  contract: Contract | null;
  userId: number;
  onOpenChange: (open: boolean) => void;
  onSigned: () => void;
}

/** Подписание документа кодом из MAX: сотрудник читает документ, запрашивает код,
 * вводит его — и подпись зафиксирована вместе с номером телефона и временем. */
const SignContractDialog = ({
  contract,
  userId,
  onOpenChange,
  onSigned,
}: SignContractDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [signing, setSigning] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  const close = () => {
    setCode('');
    setCodeSent(false);
    onOpenChange(false);
  };

  const handleSendCode = async () => {
    if (!contract) return;
    setSending(true);
    try {
      await sendSignCode(contract.id, userId);
      setCodeSent(true);
      toast({
        title: 'Код отправлен в MAX',
        description: 'Откройте чат с ботом МЕГАТЮЛЬ и введите код сюда',
      });
    } catch (e) {
      toast({
        title: 'Не удалось отправить код',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleSign = async () => {
    if (!contract || code.trim().length < 4) return;
    setSigning(true);
    try {
      await signContract(contract.id, userId, code.trim());
      toast({ title: 'Документ подписан', description: contract.title });
      close();
      onSigned();
    } catch (e) {
      toast({
        title: 'Не удалось подписать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSigning(false);
    }
  };

  return (
    <Dialog open={!!contract} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Подписание документа</DialogTitle>
        </DialogHeader>

        {contract && (
          <div className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="font-semibold">{contract.title}</p>
              <a
                href={contractFileUrl(contract.id, user?.id)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary underline underline-offset-2"
              >
                <Icon name="FileText" size={14} />
                Открыть и прочитать документ
              </a>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
              <p>
                Вводя код из MAX, вы подписываете документ. Подпись равнозначна собственноручной.
              </p>
            </div>

            {!codeSent ? (
              <Button className="w-full" disabled={sending} onClick={handleSendCode}>
                {sending ? (
                  <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                ) : (
                  <Icon name="MessageCircle" size={16} className="mr-2" />
                )}
                Получить код в MAX
              </Button>
            ) : (
              <div className="space-y-2">
                <Input
                  inputMode="numeric"
                  placeholder="Код из MAX"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center font-mono-tech text-lg tracking-[0.4em]"
                  autoFocus
                />
                <Button
                  className="w-full"
                  disabled={signing || code.trim().length < 4}
                  onClick={handleSign}
                >
                  {signing ? (
                    <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                  ) : (
                    <Icon name="PenLine" size={16} className="mr-2" />
                  )}
                  Подписать документ
                </Button>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sending}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Отправить код повторно
                </button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SignContractDialog;