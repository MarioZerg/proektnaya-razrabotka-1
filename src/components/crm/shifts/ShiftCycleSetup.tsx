import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setShiftCycle, type ShiftCycle } from '@/lib/shiftsApi';

interface ShiftCycleSetupProps {
  workshopId: number;
  shiftNumber: number;
  shiftName: string;
  cycle: ShiftCycle | null;
  onSaved: () => void;
}

/** Настройка цикличного графика смены (2/2, 3/3 и т.п.): админ указывает, сколько дней
 * смена работает, сколько отдыхает, и дату первого выхода. Дальше выходные считаются
 * автоматически — вручную отмечать каждый день не нужно. */
const ShiftCycleSetup = ({
  workshopId,
  shiftNumber,
  shiftName,
  cycle,
  onSaved,
}: ShiftCycleSetupProps) => {
  const { toast } = useToast();
  const [workDays, setWorkDays] = useState('2');
  const [offDays, setOffDays] = useState('2');
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWorkDays(cycle ? String(cycle.workDays) : '2');
    setOffDays(cycle ? String(cycle.offDays) : '2');
    setStartDate(cycle?.startDate || '');
  }, [cycle, workshopId, shiftNumber]);

  const handleSave = async () => {
    if (!startDate) {
      toast({ title: 'Укажите дату первого выхода смены', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await setShiftCycle({
        workshopId,
        shiftNumber,
        workDays: Number(workDays),
        offDays: Number(offDays),
        startDate,
      });
      toast({ title: `График ${workDays}/${offDays} включён для «${shiftName}»` });
      onSaved();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить график',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setSaving(true);
    try {
      await setShiftCycle({ workshopId, shiftNumber });
      toast({ title: 'Автоматический график выключен', description: 'Выходные отмечайте вручную' });
      onSaved();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-center gap-2">
        <Icon name="CalendarSync" size={18} className="text-muted-foreground" />
        <p className="font-medium">Автоматический график смены</p>
      </div>

      {cycle ? (
        <p className="text-sm text-muted-foreground">
          Сейчас: работает {cycle.workDays} дн., отдыхает {cycle.offDays} дн. Первый выход —{' '}
          {new Date(cycle.startDate).toLocaleDateString('ru-RU')}. Выходные в календаре ниже
          считаются автоматически.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Включите, чтобы не отмечать каждый выходной вручную: система сама разложит рабочие и
          выходные дни и не даст двум сменам выйти в один день.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Работает, дней</Label>
          <Input
            className="w-28"
            value={workDays}
            onChange={(e) => setWorkDays(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Отдыхает, дней</Label>
          <Input
            className="w-28"
            value={offDays}
            onChange={(e) => setOffDays(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Первый выход</Label>
          <Input
            type="date"
            className="w-44"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Применить график'}
        </Button>
        {cycle && (
          <Button variant="outline" onClick={handleDisable} disabled={saving}>
            Выключить
          </Button>
        )}
      </div>
    </div>
  );
};

export default ShiftCycleSetup;
