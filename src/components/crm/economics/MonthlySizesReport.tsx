import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { fetchMonthlyReport, type MonthlyReport } from '@/lib/unitEconomicsApi';

const MONTH_NAMES = [
  'янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** «2026-06-01» → «июн 26». Колонок много, поэтому подпись короткая. */
const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}`;
};

const money = (v: number) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)} млн`;
  if (v >= 1000) return `${Math.round(v / 1000)} тыс`;
  return String(Math.round(v));
};

/**
 * Насколько выручка изменилась к прошлому месяцу, %.
 *
 * Именно изменение и есть сигнал: сама по себе сумма ничего не говорит, пока
 * не с чем сравнить.
 */
const change = (now: number, before: number): number | null => {
  if (!before) return null;
  return ((now - before) / before) * 100;
};

/**
 * Помесячная динамика продаж по размерам.
 *
 * Отвечает на вопрос, который по одной цифре за 30 дней не виден: выручка по
 * размеру просела — это спрос ушёл или мы просто перестали его рекламировать?
 *
 * Читать нужно ПАРУ «выручка + ДРР» (строка ДРР — над таблицей):
 *   выручка вниз, ДРР вверх — размер теряет спрос, реклама его уже не тянет;
 *   выручка вверх, ДРР вверх сильнее — рост куплен за рекламу и ест маржу.
 */
const MonthlySizesReport = ({ marketplace }: { marketplace: string }) => {
  const [data, setData] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchMonthlyReport(marketplace, 6)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [marketplace]);

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Собираю отчёт по месяцам...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.sizes.length === 0) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Нет данных о продажах за последние месяцы
        </CardContent>
      </Card>
    );
  }

  const { sizes, adByMonth } = data;

  // Месяцы, в которых заказов почти не было, из таблицы убираем.
  //
  // Заказы в систему загрузили не с самого начала работы магазина: за старые
  // месяцы в базе лежит по одной-две штуки. Такие колонки не история, а шум —
  // рядом с ними рост выглядит как «+2654%», и настоящая динамика теряется.
  const MIN_ORDERS = 20;
  const months = data.months.filter((m) => {
    const total = sizes.reduce((sum, s) => sum + (s.byMonth[m]?.count || 0), 0);
    return total >= MIN_ORDERS;
  });

  if (months.length === 0) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Пока мало данных для сравнения по месяцам — нужен хотя бы один полный
          месяц продаж
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon name="TrendingUp" size={15} />
          Динамика по размерам, месяц к месяцу
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Выручка падает, а ДРР растёт — размер теряет спрос, и реклама его уже
          не вытягивает. Выручка растёт, но ДРР растёт быстрее — рост куплен за
          рекламу и съедает маржу
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">Размер</TableHead>
              {months.map((m) => (
                <TableHead key={m} className="text-right text-primary-foreground">
                  {monthLabel(m)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* ДРР — общий по площадке: OZON списывает рекламу одной суммой,
                разложить её по размерам физически не из чего. Ставим строку
                НАД размерами: сначала видно фон, потом частности. */}
            <TableRow className="bg-muted/50">
              <TableCell className="font-medium">
                ДРР по магазину
              </TableCell>
              {months.map((m) => {
                const ad = adByMonth[m];
                return (
                  <TableCell key={m} className="text-right font-mono-tech text-sm">
                    {ad?.adPercent != null ? `${ad.adPercent}%` : '—'}
                  </TableCell>
                );
              })}
            </TableRow>

            {sizes.map((s) => (
              <TableRow key={s.width}>
                <TableCell className="font-medium">{s.width} см</TableCell>
                {months.map((m, i) => {
                  const cell = s.byMonth[m];
                  const prev = i > 0 ? s.byMonth[months[i - 1]] : undefined;
                  const diff = cell && prev
                    ? change(cell.revenue, prev.revenue)
                    : null;
                  return (
                    <TableCell key={m} className="text-right">
                      {cell ? (
                        <>
                          <div className="font-mono-tech text-sm">
                            {money(cell.revenue)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {cell.count} шт
                            {diff != null && (
                              <span
                                className={`ml-1 font-medium ${
                                  diff < -15
                                    ? 'text-destructive'
                                    : diff > 15
                                      ? 'text-emerald-700'
                                      : 'text-muted-foreground'
                                }`}
                              >
                                {diff > 0 ? '+' : ''}
                                {Math.round(diff)}%
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Текущий месяц ещё идёт: сравнивать его с прошлым напрямую нельзя —
            падение будет мнимым просто потому, что месяц не дожил до конца. */}
        {months[months.length - 1]?.slice(0, 7) ===
          new Date().toISOString().slice(0, 7) && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-800">
            <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
            Последний месяц ещё не закончился — он всегда будет выглядеть ниже
            предыдущего. Сравнивайте его, когда месяц закроется
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Выручка считается по текущим ценам прайса: показывает объём продаж в
          штуках и деньгах, а не фактические поступления от площадки
        </p>
      </CardContent>
    </Card>
  );
};

export default MonthlySizesReport;
