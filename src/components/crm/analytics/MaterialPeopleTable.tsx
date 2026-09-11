import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
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

/**
 * Сотрудники: недостача и брак В ОДНОЙ СТРОКЕ.
 *
 * Ради этого отчёт и объединялся. Две цифры рядом читаются иначе, чем порознь:
 * «недостача 190 м, брака ноль» — это не два факта, а один вывод. Сортировка по
 * общим потерям в деньгах: сверху те, на ком теряем больше всего.
 */
const MaterialPeopleTable = ({ people, loading }: Props) => {
  const rows = people.filter(
    (p) => p.shortageQty > 0 || p.defectQty > 0 || p.rollsClosed > 0,
  );

  return (
    <div className="overflow-x-auto rounded-md border border-border">
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
          {loading ? (
            <TableRow>
              <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                <Icon name="Loader2" size={16} className="mr-2 inline animate-spin" />
                Загрузка…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                За выбранный период данных нет
              </TableCell>
            </TableRow>
          ) : (
            rows.map((p) => (
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
                {/* Брак нулём выделяем красным только у тех, кто реально работал:
                    ноль у работавшего человека — это не идеал, а молчаливое
                    выбрасывание обрезков. */}
                <TableCell className="text-right">
                  {p.defectQty > 0 ? (
                    num(p.defectQty)
                  ) : p.shifts > 0 && p.rollsClosed > 0 ? (
                    <span className="font-semibold text-red-700">нет</span>
                  ) : (
                    '—'
                  )}
                </TableCell>
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
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default MaterialPeopleTable;
