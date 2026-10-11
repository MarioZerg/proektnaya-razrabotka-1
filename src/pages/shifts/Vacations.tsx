import { useCallback, useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import VacationCalendar from '@/components/crm/vacations/VacationCalendar';
import {
  cancelVacation,
  fetchVacationBoard,
  type VacationBoard,
} from '@/lib/usersApi';

/** Календарь отпусков для администратора: кто на какие даты забронировал дни. */
const Vacations = () => {
  const { toast } = useToast();
  const [board, setBoard] = useState<VacationBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchVacationBoard()
      .then((data) => {
        setError(null);
        setBoard(data);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Не удалось загрузить отпуска');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (id: number) => {
    try {
      await cancelVacation(id);
      toast({ title: 'Бронь снята' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось снять бронь',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">Отпуск</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Один отпуск за полугодие, ровно на 14 дней. Правила — над календарём.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {board && (
          <VacationCalendar
            people={board.people}
            today={board.today}
            onCancel={cancel}
          />
        )}
      </div>
    </CrmLayout>
  );
};

export default Vacations;
