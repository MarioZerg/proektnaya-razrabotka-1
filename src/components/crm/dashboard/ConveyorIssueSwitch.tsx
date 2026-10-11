import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchConveyorIssue, setConveyorIssue } from '@/lib/ordersApi';

/**
 * Рубильник выдачи заказов. Стоит в настройках цеха: на главной он мешал сводке.
 *
 * Выключил — закройщик, швея и оверлок не получают новые заказы, пока не
 * включат снова. Уже взятую работу (раскрой, пошив, стикеровку) не трогает.
 * Настройка одна на весь конвейер, не на отдельный цех.
 */
const ConveyorIssueSwitch = () => {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConveyorIssue().then(setEnabled).catch(() => setEnabled(true));
  }, []);

  const onToggle = async (next: boolean) => {
    setSaving(true);
    setEnabled(next);
    try {
      const res = await setConveyorIssue(next);
      setEnabled(res.conveyorIssueEnabled);
      toast({
        title: next ? 'Выдача заказов включена' : 'Конвейер выключен',
        description: next
          ? 'Закройщики и швеи снова могут брать заказы'
          : 'Новые заказы с конвейера сейчас не выдают',
      });
    } catch (e) {
      setEnabled(!next);
      toast({
        title: 'Не удалось переключить конвейер',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
        enabled ? 'border-border bg-card' : 'border-amber-300 bg-amber-50 text-amber-950'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-semibold">
          <Icon name={enabled ? 'Play' : 'Pause'} size={18} />
          Выдача заказов
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {enabled
            ? 'Конвейер выдаёт стек, пошив и оверлок как обычно'
            : 'Конвейер выключен — сотрудники не могут взять заказ'}
        </p>
      </div>
      <Switch
        checked={enabled}
        disabled={saving}
        onCheckedChange={onToggle}
        aria-label="Выдача заказов с конвейера"
      />
    </div>
  );
};

export default ConveyorIssueSwitch;
