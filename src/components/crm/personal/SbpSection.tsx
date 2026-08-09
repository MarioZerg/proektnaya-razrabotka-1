import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { confirmSbp, saveSbp, type PersonalData } from '@/lib/personalDataApi';

interface SbpSectionProps {
  data: PersonalData;
  userId: number;
  actorId: number;
  isAdmin: boolean;
  onChanged: () => void;
}

/** Реквизиты для выплат по СБП: сотрудник вводит сам, админ подтверждает кнопкой.
 * Любое изменение номера сбрасывает подтверждение — иначе реквизиты можно подменить
 * уже после проверки, и деньги уйдут на чужой счёт. */
const SbpSection = ({ data, userId, actorId, isAdmin, onChanged }: SbpSectionProps) => {
  const { toast } = useToast();
  const [phone, setPhone] = useState(data.sbpPhone || '');
  const [bank, setBank] = useState(data.sbpBank || '');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setPhone(data.sbpPhone || '');
    setBank(data.sbpBank || '');
  }, [data.sbpPhone, data.sbpBank]);

  const dirty = phone !== (data.sbpPhone || '') || bank !== (data.sbpBank || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSbp({ userId, actorId, sbpPhone: phone, sbpBank: bank });
      toast({
        title: 'Реквизиты сохранены',
        description: 'Администратор проверит их перед отправкой договора',
      });
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmSbp(userId, actorId);
      toast({ title: 'Реквизиты подтверждены' });
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">Куда переводить деньги</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Выплаты приходят по СБП на номер телефона
          </p>
        </div>
        {data.sbpPhone &&
          (data.sbpConfirmed ? (
            <Badge variant="secondary">Подтверждены</Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500 text-amber-600">
              Ждут проверки
            </Badge>
          ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Номер телефона</Label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 999 123-45-67"
            inputMode="tel"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Банк получателя</Label>
          <Input
            value={bank}
            onChange={(e) => setBank(e.target.value)}
            placeholder="Сбербанк, Т-Банк, Альфа-Банк…"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Укажите банк, который стоит основным для переводов по номеру телефона. Если
        номер или банк изменятся, поправьте здесь и предупредите администратора
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving || !dirty} onClick={handleSave}>
          {saving ? (
            <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
          ) : (
            <Icon name="Check" size={14} className="mr-1.5" />
          )}
          Сохранить реквизиты
        </Button>

        {isAdmin && data.sbpPhone && !data.sbpConfirmed && (
          <Button size="sm" variant="outline" disabled={confirming} onClick={handleConfirm}>
            {confirming ? (
              <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Icon name="ShieldCheck" size={14} className="mr-1.5" />
            )}
            Подтвердить реквизиты
          </Button>
        )}
      </div>
    </div>
  );
};

export default SbpSection;
