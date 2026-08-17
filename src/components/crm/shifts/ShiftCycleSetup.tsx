import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setShiftCycle, setShiftWeekdays, type ShiftCycle } from '@/lib/shiftsApi';

const WEEKDAYS = [
  { num: 1, short: 'Пн' },
  { num: 2, short: 'Вт' },
  { num: 3, short: 'Ср' },
  { num: 4, short: 'Чт' },
  { num: 5, short: 'Пт' },
  { num: 6, short: 'Сб' },
  { num: 7, short: 'Вс' },
];

type Mode = 'none' | 'cycle' | 'weekdays';

interface ShiftCycleSetupProps {
  workshopId: number;
  shiftNumber: number;
  shiftName: string;
  cycle: ShiftCycle | null;
  workWeekdays: number[] | null;
  onSaved: () => void;
}

/** Настройка графика смены двумя способами: цикл со сдвигом (2/2, 3/3 — отсчёт от даты
 * первого выхода) или по дням недели (5/2 — фиксированные выходные СБ/ВС). Выходные
 * дальше считаются автоматически, вручную отмечать каждый день не нужно. */
const ShiftCycleSetup = ({
  workshopId,
  shiftNumber,
  shiftName,
  cycle,
  workWeekdays,
  onSaved,
}: ShiftCycleSetupProps) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('none');
  const [workDays, setWorkDays] = useState('2');
  const [offDays, setOffDays] = useState('2');
  const [startDate, setStartDate] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (workWeekdays) {
      setMode('weekdays');
      setSelectedDays(workWeekdays);
    } else if (cycle) {
      setMode('cycle');
      setWorkDays(String(cycle.workDays));
      setOffDays(String(cycle.offDays));
      setStartDate(cycle.startDate);
    } else {
      setMode('none');
    }
  }, [cycle, workWeekdays, workshopId, shiftNumber]);

  const saveCycle = async (force = false) => {
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
        force,
      });
      toast({ title: `График ${workDays}/${offDays} включён для «${shiftName}»` });
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // Пересечение с другой сменой — не всегда ошибка: 5/2 обязана работать вместе
      // с бригадами 2/2. Спрашиваем подтверждение и сохраняем повторно.
      if (msg.includes('одновременно') && confirm(`${msg}. Всё равно сохранить?`)) {
        await saveCycle(true);
        return;
      }
      toast({ title: 'Не удалось сохранить график', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const saveWeekdays = async () => {
    if (selectedDays.length === 0) {
      toast({ title: 'Выберите хотя бы один рабочий день', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await setShiftWeekdays({ workshopId, shiftNumber, workWeekdays: selectedDays });
      toast({ title: `График по дням недели включён для «${shiftName}»` });
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
      if (workWeekdays) await setShiftWeekdays({ workshopId, shiftNumber, workWeekdays: null });
      else await setShiftCycle({ workshopId, shiftNumber });
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

  const toggleDay = (num: number) =>
    setSelectedDays((prev) =>
      prev.includes(num) ? prev.filter((d) => d !== num) : [...prev, num].sort()
    );

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex items-center gap-2">
        <Icon name="CalendarSync" size={18} className="text-muted-foreground" />
        <p className="font-medium">Автоматический график смены</p>
      </div>

      {workWeekdays && (
        <p className="text-sm text-muted-foreground">
          Сейчас работает по дням недели:{' '}
          {WEEKDAYS.filter((d) => workWeekdays.includes(d.num))
            .map((d) => d.short)
            .join(', ')}
          . Остальные дни — выходные.
        </p>
      )}
      {cycle && !workWeekdays && (
        <p className="text-sm text-muted-foreground">
          Сейчас: работает {cycle.workDays} дн., отдыхает {cycle.offDays} дн. Первый выход —{' '}
          {new Date(cycle.startDate).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={mode === 'cycle' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('cycle')}
        >
          Цикл 2/2, 3/3
        </Button>
        <Button
          variant={mode === 'weekdays' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('weekdays')}
        >
          По дням недели (5/2)
        </Button>
      </div>

      {mode === 'cycle' && (
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
              className="w-full sm:w-44"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <Button onClick={() => saveCycle()} disabled={saving}>
            {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Применить'}
          </Button>
        </div>
      )}

      {mode === 'weekdays' && (
        <div className="space-y-3">
          <Label>Рабочие дни недели</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <button
                key={d.num}
                onClick={() => toggleDay(d.num)}
                className={`h-10 w-12 rounded-md border text-sm font-medium transition ${
                  selectedDays.includes(d.num)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {d.short}
              </button>
            ))}
          </div>
          <Button onClick={saveWeekdays} disabled={saving}>
            {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Применить'}
          </Button>
        </div>
      )}

      {(cycle || workWeekdays) && (
        <Button variant="outline" size="sm" onClick={handleDisable} disabled={saving}>
          Выключить автоматический график
        </Button>
      )}
    </div>
  );
};

export default ShiftCycleSetup;
