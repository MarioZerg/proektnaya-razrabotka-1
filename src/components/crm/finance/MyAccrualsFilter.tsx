import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { formatDate, formatMoney } from '@/components/crm/finance/financeShared';
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

const periodCaption = (from: string, to: string) => {
  if (from && to && from === to) return formatDate(from);
  if (from && to) return `${formatDate(from)} — ${formatDate(to)}`;
  if (from) return `с ${formatDate(from)}`;
  if (to) return `по ${formatDate(to)}`;
  return 'Все время';
};

/**
 * Фильтр по датам в личных финансах сотрудника.
 *
 * Даты и кнопки «Сегодня / Вчера / …» спрятаны в сворачиваемое меню — иначе
 * на телефоне они занимают пол-экрана и мешают смотреть начисления. Итог
 * за период остаётся снаружи: именно ради «сколько заработала» фильтр и нужен.
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
  const [open, setOpen] = useState(false);

  const setDay = (offset: number) => {
    const d = moscowYmd(offset);
    setDateFrom(d);
    setDateTo(d);
    setOpen(false);
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
    } else if (kind === 'month') {
      setDateFrom(ymd(y, m, 1));
      setDateTo(ymd(y, m, new Date(y, m + 1, 0).getDate()));
    } else {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      setDateFrom(ymd(py, pm, 1));
      setDateTo(ymd(py, pm, new Date(py, pm + 1, 0).getDate()));
    }
    setOpen(false);
  };

  const active = !!dateFrom || !!dateTo;

  return (
    <div className="space-y-3 rounded-md border border-border p-3 sm:p-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 min-w-0 flex-1 justify-between px-3 sm:h-9 sm:max-w-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="Calendar" size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate text-left">
                  <span className="font-medium">Период</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {periodCaption(dateFrom, dateTo)}
                  </span>
                </span>
              </span>
              <Icon
                name="ChevronRight"
                size={14}
                className={`shrink-0 text-muted-foreground transition-transform ${
                  open ? 'rotate-90' : ''
                }`}
              />
            </Button>
          </CollapsibleTrigger>
          {active && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 shrink-0 px-2 sm:h-9"
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

        <CollapsibleContent>
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <div className="grid min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
              <div className="min-w-0 flex-1 space-y-1 sm:max-w-[11.5rem]">
                <Label className="text-xs text-muted-foreground">С даты</Label>
                <Input
                  type="date"
                  className="h-11 w-full min-w-0 sm:h-9"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1 sm:max-w-[11.5rem]">
                <Label className="text-xs text-muted-foreground">По дату</Label>
                <Input
                  type="date"
                  className="h-11 w-full min-w-0 sm:h-9"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => setDay(0)}
              >
                Сегодня
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => setDay(-1)}
              >
                Вчера
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => setRange('week')}
              >
                7 дней
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => setRange('month')}
              >
                Этот месяц
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="col-span-2 h-11 sm:h-9"
                onClick={() => setRange('prevMonth')}
              >
                Прошлый месяц
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

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
            {shown < count ? ` (в списке показаны последние ${shown})` : ''}
          </p>
        </div>
      )}
    </div>
  );
};

export default MyAccrualsFilter;
