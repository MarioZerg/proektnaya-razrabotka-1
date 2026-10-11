import type { VacationBooking, VacationPerson } from '@/lib/usersApi';

/** «1 день», «3 дня», «7 дней». */
export const dayWord = (n: number) => {
  const last = n % 10;
  const twoLast = n % 100;
  if (twoLast >= 11 && twoLast <= 14) return 'дней';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дня';
  return 'дней';
};

export const formatVacationDay = (iso: string) =>
  new Date(iso.slice(0, 10) + 'T00:00:00+03:00').toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });

const dayNumber = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000;

const daysUntil = (today: string, target: string) =>
  Math.max(0, Math.round(dayNumber(target) - dayNumber(today)));

const nextDay = (iso: string) => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/** Отпуск, который идёт сегодня: сотрудник уже ушёл и ещё не вышел. */
export const activeBooking = (
  bookings: VacationBooking[],
  today: string,
): VacationBooking | null =>
  bookings.find((item) => item.from <= today && today <= item.to) || null;

/**
 * Строка под вариками.
 *
 * До отпуска — сколько дней ждать от даты выхода в профиле.
 * В отпуске — с какого числа по какое. После конца снова дни до следующего окна.
 */
export const vacationMenuText = (person: VacationPerson, today: string) => {
  const away = activeBooking(person.bookings, today);
  if (away) {
    return `с ${formatVacationDay(away.from)} по ${formatVacationDay(away.to)}`;
  }
  if (!person.hiredAt) return 'Дата выхода не указана';
  if (person.eligibleFrom && person.eligibleFrom > today) {
    const days = daysUntil(today, person.eligibleFrom);
    return `Через ${days} ${dayWord(days)}`;
  }
  const upcoming = person.bookings
    .filter((item) => item.from > today)
    .sort((a, b) => a.from.localeCompare(b.from))[0];
  if (upcoming) {
    const days = daysUntil(today, upcoming.from);
    return `Через ${days} ${dayWord(days)}`;
  }
  if (person.takenThisPeriod && person.periodTo) {
    const days = daysUntil(today, nextDay(person.periodTo));
    return `Через ${days} ${dayWord(days)}`;
  }
  if (person.takenThisPeriod) return 'В этом полугодии отпуск уже выбран';
  return 'Можно выбрать со следующего дня';
};
