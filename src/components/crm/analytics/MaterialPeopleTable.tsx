import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MaterialPerson } from '@/lib/rollsApi';

interface Props {
  people: MaterialPerson[];
  loading: boolean;
}

const roleLabel: Record<string, string> = {
  sewer: 'Швея',
  cutter: 'Закройщик',
  packer: 'Упаковщик',
  storekeeper: 'Кладовщик',
  senior_storekeeper: 'Ст. кладовщик',
  admin: 'Администратор',
};

const num = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';

const defectCell = (p: MaterialPerson) => {
  if (p.defectQty > 0) return num(p.defectQty);
  if (p.shifts > 0 && p.rollsClosed > 0) {
    return <span className="font-semibold text-red-700">нет</span>;
  }
  return '—';
};

/**
 * Сотрудники: недостача и брак В ОДНОЙ СТРОКЕ.
 *
 * Ради этого отчёт и объединялся. Две цифры рядом читаются иначе, чем порознь:
 * «недостача 190 м, брака ноль» — это не два факта, а один вывод. Сортировка по
 * общим потерям в деньгах: сверху те, на ком теряем больше всего.
 *
 * На телефоне и узком окне девять колонок не влезают — карточка, таблица с lg.
 */
const MaterialPeopleTable = ({ people, loading }: Props) => {
  const rows = people.filter(
    (p) => p.shortageQty > 0 || p.defectQty > 0 || p.rollsClosed > 0,
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        За выбранный период данных нет
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2 lg:hidden">
        {rows.map((p) => (
          <div
            key={p.userName}
            className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words font-semibold leading-snug">{p.userName}</p>
              {p.signals.length > 0 && (
                <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0 text-amber-600" />
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {roleLabel[p.role || ''] || p.role || '—'}
              {p.rollsClosed ? ` · ${p.rollsClosed} рул.` : ''}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <span className="text-muted-foreground">Недостача</span>
              <span className="text-right tabular-nums">
                {p.shortageQty > 0 ? num(p.shortageQty) : '—'}
                {p.shortagePercent > 0 ? (
                  <Badge
                    variant="secondary"
                    className={`ml-1.5 align-middle ${
                      p.shortagePercent >= 5
                        ? 'bg-red-100 text-red-700 hover:bg-red-100'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {p.shortagePercent.toFixed(1)}%
                  </Badge>
                ) : null}
              </span>
              <span className="text-muted-foreground">Брак</span>
              <span className="text-right tabular-nums">{defectCell(p)}</span>
              <span className="text-muted-foreground">Макс. кусок</span>
              <span
                className={`text-right tabular-nums ${
                  p.defectMaxPiece >= 15 ? 'font-semibold text-red-700' : ''
                }`}
              >
                {p.defectMaxPiece > 0 ? num(p.defectMaxPiece) : '—'}
              </span>
              <span className="text-muted-foreground">Потери</span>
              <span className="text-right font-semibold tabular-nums">
                {money(p.shortageMoney + p.defectMoney)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">Сотрудник</TableHead>
              <TableHead className="text-primary-foreground">Должность</TableHead>
              <TableHead className="text-right text-primary-foreground">Рулонов</TableHead>
              <TableHead className="text-right text-primary-foreground">Недостача</TableHead>
              <TableHead className="text-right text-primary-foreground">%</TableHead>
              <TableHead className="text-right text-primary-foreground">Брак</TableHead>
              <TableHead className="text-right text-primary-foreground">Записей</TableHead>
              <TableHead className="text-right text-primary-foreground">Макс. кусок</TableHead>
              <TableHead className="text-right text-primary-foreground">Потери</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.userName}>
                <TableCell className="font-medium">
                  {p.userName}
                  {p.signals.length > 0 && (
                    <Icon
                      name="TriangleAlert"
                      size={14}
                      className="ml-1.5 inline text-amber-600"
                    />
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {roleLabel[p.role || ''] || p.role || '—'}
                </TableCell>
                <TableCell className="text-right">{p.rollsClosed || '—'}</TableCell>
                <TableCell className="text-right">
                  {p.shortageQty > 0 ? num(p.shortageQty) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {p.shortagePercent > 0 ? (
                    <Badge
                      variant="secondary"
                      className={
                        p.shortagePercent >= 5
                          ? 'bg-red-100 text-red-700 hover:bg-red-100'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-100'
                      }
                    >
                      {p.shortagePercent.toFixed(1)}%
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right">{defectCell(p)}</TableCell>
                <TableCell className="text-right">{p.defectCount || '—'}</TableCell>
                <TableCell className="text-right">
                  {p.defectMaxPiece > 0 ? (
                    <span className={p.defectMaxPiece >= 15 ? 'font-semibold text-red-700' : ''}>
                      {num(p.defectMaxPiece)}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-medium">
                  {money(p.shortageMoney + p.defectMoney)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
};

export default MaterialPeopleTable;
