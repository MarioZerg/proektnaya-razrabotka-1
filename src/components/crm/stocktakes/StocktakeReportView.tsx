import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { StocktakeReport } from '@/lib/stocktakesApi';

interface StocktakeReportViewProps {
  report: StocktakeReport;
}

/**
 * Что показал пересчёт: сколько нашли, чего не хватает, что лежит не на месте.
 *
 * Недостача — главное число: именно эти вещи админ будет списывать. Поэтому она
 * идёт первой и красным, а не прячется под списком найденного.
 */
const StocktakeReportView = ({ report }: StocktakeReportViewProps) => {
  const progress =
    report.expected > 0 ? Math.round((report.foundCount / report.expected) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Числится на полках</p>
          <p className="text-xl font-bold">{report.expected}</p>
        </div>
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-900">Пересчитано</p>
          <p className="text-xl font-bold text-emerald-900">
            {report.foundCount}
            <span className="ml-1 text-sm font-normal">({progress}%)</span>
          </p>
        </div>
        <div
          className={`rounded-md border p-3 ${
            report.missingCount > 0
              ? 'border-red-300 bg-red-50'
              : 'border-border'
          }`}
        >
          <p className={`text-xs ${report.missingCount > 0 ? 'text-red-900' : 'text-muted-foreground'}`}>
            Не найдено
          </p>
          <p className={`text-xl font-bold ${report.missingCount > 0 ? 'text-red-900' : ''}`}>
            {report.missingCount}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Не на своей полке</p>
          <p className="text-xl font-bold">{report.misplaced.length}</p>
        </div>
      </div>

      {report.shelves.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium">Полки</p>
          <div className="flex flex-wrap gap-2">
            {report.shelves.map((s) => {
              const done = s.expected > 0 && s.found >= s.expected;
              return (
                <span
                  key={s.shelfId}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    done
                      ? 'bg-emerald-100 text-emerald-900'
                      : s.found > 0
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {s.shelfName}: {s.found} из {s.expected}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {report.missingCount > 0 && (
        <div className="rounded-md border border-red-300">
          <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2">
            <Icon name="TriangleAlert" size={16} className="text-red-600" />
            <span className="text-sm font-semibold text-red-900">
              Не найдено на складе: {report.missingCount}
            </span>
            <Badge variant="destructive" className="ml-auto">
              будут списаны после подтверждения
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Стикер</TableHead>
                <TableHead>Товар</TableHead>
                <TableHead>Заказ</TableHead>
                <TableHead>Числится на полке</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.missing.map((m) => (
                <TableRow key={m.barcode}>
                  <TableCell className="font-mono-tech text-xs">{m.barcode}</TableCell>
                  <TableCell>{m.product || '—'}</TableCell>
                  <TableCell>{m.orderNumber || '—'}</TableCell>
                  <TableCell>{m.shelfName || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {report.misplaced.length > 0 && (
        <div className="rounded-md border border-amber-300">
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">
            Лежат не на своей полке: {report.misplaced.length}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Стикер</TableHead>
                <TableHead>Товар</TableHead>
                <TableHead>Числилась</TableHead>
                <TableHead>Найдена</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.misplaced.map((m) => (
                <TableRow key={m.barcode}>
                  <TableCell className="font-mono-tech text-xs">{m.barcode}</TableCell>
                  <TableCell>{m.product || '—'}</TableCell>
                  <TableCell>{m.expectedShelfName || '—'}</TableCell>
                  <TableCell className="font-medium">{m.shelfName || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {report.extra.length > 0 && (
        <div className="rounded-md border border-border">
          <div className="border-b border-border bg-muted/50 px-4 py-2 text-sm font-semibold">
            Излишки — отсканированы, но на складе не числятся: {report.extra.length}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Стикер</TableHead>
                <TableHead>Товар</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.extra.map((m) => (
                <TableRow key={m.barcode}>
                  <TableCell className="font-mono-tech text-xs">{m.barcode}</TableCell>
                  <TableCell>{m.product || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default StocktakeReportView;
