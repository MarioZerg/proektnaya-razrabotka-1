import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { fetchVacationBoard } from '@/lib/usersApi';
import { activeBooking, formatVacationDay } from '@/lib/vacationStatus';

interface OnLeave {
  id: number;
  fullName: string;
  from: string;
  to: string;
}

/**
 * Кто сейчас в отпуске — на главной у администратора.
 *
 * Список живой: берётся из календаря отпусков в момент открытия главной.
 * Когда даты прошли, сотрудник из списка пропадает и смену открывает как обычно.
 */
const VacationOnLeaveCard = () => {
  const [items, setItems] = useState<OnLeave[]>([]);
  const [ready, setReady] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = () => {
    fetchVacationBoard()
      .then((board) => {
        const away = board.people.flatMap((person) => {
          const booking = activeBooking(person.bookings, board.today);
          if (!booking) return [];
          return [{
            id: person.id,
            fullName: person.fullName,
            from: booking.from,
            to: booking.to,
          }];
        });
        setListError(null);
        setItems(away);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить отпуска');
      })
      .finally(() => setReady(true));
  };

  useEffect(load, []);

  if (!ready && !listError) return null;
  if (listError && items.length === 0) {
    return (
      <WarehouseFetchError
        title="Не удалось загрузить отпуска"
        description={listError}
        onRetry={load}
      />
    );
  }
  if (items.length === 0) return null;

  return (
    <Card className="border-teal-200 bg-teal-50 shadow-none">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-700">
          <Icon name="Calendar" size={20} />
        </span>
        <ul className="min-w-0 flex-1 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="text-sm font-medium text-teal-950">
              {item.fullName} в отпуске с {formatVacationDay(item.from)} по {formatVacationDay(item.to)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

export default VacationOnLeaveCard;
