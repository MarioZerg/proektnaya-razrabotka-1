import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface MyAccrualsFilterProps {
  dateFrom: string;
  dateTo: string;
  setDateFrom: (v: string) => void;
  setDateTo: (v: string) => void;
  /** Заработано за выбранный период — без штрафов, «грязными». */
  earned: number;
  /** Удержано штрафами за тот же период. */
  penalties: number;
  /** Сколько строк попало в период — чтобы было видно, что фильтр сработал. */
  count: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

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
}: MyAccrualsFilterProps) => {
  const setDay = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    setDateFrom(iso(d));
    setDateTo(iso(d));
  };

  const setRange = (kind: 'week' | 'month' | 'prevMonth') => {
    const now = new Date();
    if (kind === 'week') {
      const from = new Date();
      from.setDate(from.getDate() - 6);
      setDateFrom(iso(from));
      setDateTo(iso(now));
      return;
    }
    if (kind === 'month') {
      setDateFrom(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
      return;
    }
    setDateFrom(iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
    setDateTo(iso(new Date(now.getFullYear(), now.getMonth(), 0)));
  };

  const active = !!dateFrom || !!dateTo;

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">С даты</Label>
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">По дату</Label>
          <Input
            type="date"
            className="h-9 w-[150px]"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {active && (
          <Button
            variant="ghost"
            size="sm"
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
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setDay(0)}>
          Сегодня
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDay(-1)}>
          Вчера
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRange('week')}>
          7 дней
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRange('month')}>
          Этот месяц
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRange('prevMonth')}>
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
          <p className="text-xs text-muted-foreground">{count} начислений</p>
        </div>
      )}
    </div>
  );
};

export default MyAccrualsFilter;
