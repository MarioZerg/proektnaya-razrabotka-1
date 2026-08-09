import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  previewGeneratedContract,
  sendGeneratedContract,
  ROLES_WITH_TEMPLATE,
} from '@/lib/contractsApi';
import type { PersonalData } from '@/lib/personalDataApi';
import { roleLabels, type Role } from '@/lib/roles';

interface GenerateContractPanelProps {
  data: PersonalData;
  userId: number;
  actorId: number;
  role?: Role;
  onSent: () => void;
}

/** Формирование договора: система собирает документ из шаблона должности и уже
 * проверенных данных. Админ сначала открывает готовый документ и убеждается, что
 * всё встало правильно, и только потом отправляет на подпись. */
const GenerateContractPanel = ({
  data,
  userId,
  actorId,
  role,
  onSent,
}: GenerateContractPanelProps) => {
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);

  const hasTemplate =
    !!role && (ROLES_WITH_TEMPLATE as readonly string[]).includes(role);

  // Договор с пустой графой паспорта недействителен, а неподтверждённый номер
  // означает выплату на чужой счёт — поэтому это блокировки, а не подсказки.
  const blockers: string[] = [];
  if (!data.personalDataVerified) blockers.push('Паспортные данные не проверены');
  if (!data.sbpPhone) blockers.push('Сотрудник не указал номер для выплат по СБП');
  else if (!data.sbpConfirmed) blockers.push('Реквизиты СБП не подтверждены');

  const ready = hasTemplate && blockers.length === 0;

  const handlePreview = async () => {
    setBusy('preview');
    try {
      const res = await previewGeneratedContract(userId, actorId, role);
      setPreviewUrl(res.fileUrl);
      window.open(res.fileUrl, '_blank', 'noopener');
    } catch (e) {
      toast({
        title: 'Не удалось собрать договор',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  const handleSend = async () => {
    setBusy('send');
    try {
      const res = await sendGeneratedContract(userId, actorId, role);
      toast({
        title: 'Договор отправлен на подпись',
        description: `${res.title} — сотрудник получит уведомление в MAX`,
      });
      setPreviewUrl('');
      onSent();
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div>
        <p className="font-bold">Договор</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasTemplate
            ? `Система соберёт договор для должности «${
                roleLabels[role as Role]
              }» и подставит данные сотрудника`
            : 'Для этой должности готового шаблона нет — направьте документ файлом со страницы «Договоры»'}
        </p>
      </div>

      {hasTemplate && blockers.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Сначала нужно закрыть:</p>
          {blockers.map((b) => (
            <p key={b} className="flex items-start gap-1.5">
              <Icon name="Dot" size={16} className="mt-0.5 shrink-0" />
              {b}
            </p>
          ))}
        </div>
      )}

      {hasTemplate && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!ready || busy !== null}
            onClick={handlePreview}
          >
            {busy === 'preview' ? (
              <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Icon name="FileSearch" size={14} className="mr-1.5" />
            )}
            Проверить договор
          </Button>

          <Button
            size="sm"
            disabled={!ready || !previewUrl || busy !== null}
            onClick={handleSend}
          >
            {busy === 'send' ? (
              <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Icon name="Send" size={14} className="mr-1.5" />
            )}
            Отправить на подпись
          </Button>
        </div>
      )}

      {hasTemplate && ready && !previewUrl && (
        <p className="text-xs text-muted-foreground">
          Сначала откройте договор и убедитесь, что данные встали правильно — после
          этого станет доступна отправка
        </p>
      )}
    </div>
  );
};

export default GenerateContractPanel;
