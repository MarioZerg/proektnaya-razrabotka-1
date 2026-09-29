import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/finance/financeShared';
import { moscowYmd } from '@/lib/dateUtils';

interface MyAccrualsFilterProps {
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  /** Заработано за выбранный период — без штрафов, «грязными». */
  earned: number;
  /** Удержано штрафами за тот же период. */
  penalties: number;
  /** Сколько начислений в периоде всего — считает сервер. */
  count: number;
  /** Сколько строк реально пришло в таблицу: длинные периоды сервер обрезает. */
  shown: number;
}

/**
 * Фильтр по датам в личных финансах сотрудника.
 *
 * Раньше сотрудник видел просто ленту начислений за всё время и не мог ответить
 * на главный свой вопрос: «сколько я заработала сегодня?» — приходилось складывать
 * строчки в уме или считать на калькуляторе, а за смену их набирается несколько
 * десятков.
 *
 * Поэтому здесь не просто фильтр, а сразу ИТОГ за выбранные дни: крупная цифра
 * заработка и отдельно — удержания. Кнопки «Сегодня» и «Вчера» стоят первыми:
 * именно эти два периода и смотрят чаще всего, обычно с телефона по дороге домой.
 */
const MyAccrualsFilter = ({
  dateFrom,
  dateTo,
  setDateFrom,
  setDateTo,
  earned,
  penalties,
  count,
  shown,
}: MyAccrualsFilterProps) => {
  const setDay = (offset: number) => {
    const d = moscowYmd(offset);
    setDateFrom(d);
    setDateTo(d);
  };

  const setRange = (kind: 'week' | 'month' | 'prevMonth') => {
    const today = moscowYmd(0);
    const [ys, ms] = today.split('-');
    const y = Number(ys);
    const m = Number(ms) - 1;
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = (year: number, monthIndex: number, day: number) =>
      `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
    if (kind === 'week') {
      setDateFrom(moscowYmd(-6));
      setDateTo(today);
      return;
    }
    if (kind === 'month') {
      setDateFrom(ymd(y, m, 1));
      setDateTo(ymd(y, m, new Date(y, m + 1, 0).getDate()));
      return;
    }
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    setDateFrom(ymd(py, pm, 1));
    setDateTo(ymd(py, pm, new Date(py, pm + 1, 0).getDate()));
  };

  const active = !!dateFrom || !!dateTo;

  return (
    <div className="space-y-3 rounded-md border border-border p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">С даты</Label>
          <Input
            type="date"
            className="h-11 w-full sm:h-9 sm:w-[150px]"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">По дату</Label>
          <Input
            type="date"
            className="h-11 w-full sm:h-9 sm:w-[150px]"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2 h-11 sm:h-9 sm:w-auto"
            onClick={() => {
              setDateFrom('');
              setDateTo('');
            }}
          >
            <Icon name="X" size={14} className="mr-1" />
            Сбросить
          </Button>
        )}
      </div>

      {/* Готовые периоды: набирать дату руками с телефона неудобно. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setDay(0)}>
          Сегодня
        </Button>
        <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setDay(-1)}>
          Вчера
        </Button>
        <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setRange('week')}>
          7 дней
        </Button>
        <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setRange('month')}>
          Этот месяц
        </Button>
        <Button variant="outline" size="sm" className="col-span-2 h-11 sm:h-9" onClick={() => setRange('prevMonth')}>
          Прошлый месяц
        </Button>
      </div>

      {/* Ради этой строки фильтр и делался: ответ на вопрос «сколько за день». */}
      {active && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-muted/50 px-3 py-2">
          <div>
            <p className="text-xs text-muted-foreground">Заработано за период</p>
            <p className="text-xl font-bold">{formatMoney(earned)} ₽</p>
          </div>
          {penalties < 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Удержано</p>
              <p className="text-lg font-semibold text-destructive">
                {formatMoney(penalties)} ₽
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {count} начислений
            {/* Итог считается по всему периоду, а в таблицу сервер отдаёт
                не больше 500 строк — предупреждаем, чтобы цифра и список
                не выглядели противоречащими друг другу. */}
            {shown < count ? ` (в списке показаны последние ${shown})` : ''}
          </p>
        </div>
      )}
    </div>
  );
};

export default MyAccrualsFilter;