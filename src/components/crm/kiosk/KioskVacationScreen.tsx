import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import VacationCalendar from '@/components/crm/vacations/VacationCalendar';
import {
  bookVacation,
  fetchVacationBoard,
  type VacationBoard,
} from '@/lib/usersApi';

interface KioskVacationScreenProps {
  userId: number;
}

/** Бронь отпуска на терминале: сотрудник выбирает свои дни заранее. */
const KioskVacationScreen = ({ userId }: KioskVacationScreenProps) => {
  const { toast } = useToast();
  const [board, setBoard] = useState<VacationBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const book = async (from: string, to: string) => {
    setSaving(true);
    try {
      await bookVacation(userId, from, to);
      toast({ title: 'Отпуск забронирован' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось забронировать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="text-lg text-destructive">{error}</p>;
  if (!board) return <p className="text-lg text-muted-foreground">Загрузка…</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <h2 className="text-2xl font-bold">Отпуск</h2>
      <VacationCalendar
        people={board.people}
        today={board.today}
        selfId={userId}
        onBook={book}
        saving={saving}
      />
    </div>
  );
};

export default KioskVacationScreen;
