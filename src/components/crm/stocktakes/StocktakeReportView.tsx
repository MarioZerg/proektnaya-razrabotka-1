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
  /**
   * Во время пересчёта — только цифры и полки, без длинных таблиц.
   * Полный отчёт (недостача, чужие полки) — при подтверждении админом.
   */
  compact?: boolean;
}

/**
 * Что показал пересчёт: сколько нашли, чего не хватает, что лежит не на месте.
 *
 * Недостача — главное число: именно эти вещи админ будет списывать. Поэтому она
 * идёт первой и красным, а не прячется под списком найденного.
 */
const StocktakeReportView = ({ report, compact = false }: StocktakeReportViewProps) => {
  const progress =
    report.expected > 0 ? Math.round((report.foundCount / report.expected) * 100) : 0;

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Числится</p>
          <p className="text-lg font-bold tabular-nums">{report.expected}</p>
        </div>
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2">
          <p className="text-xs text-emerald-900">Найдено</p>
          <p className="text-lg font-bold tabular-nums text-emerald-900">
            {report.foundCount}
            <span className="ml-1 text-xs font-normal">({progress}%)</span>
          </p>
        </div>
        <div
          className={`rounded-md border px-3 py-2 ${
            report.missingCount > 0
              ? 'border-red-300 bg-red-50'
              : 'border-border'
          }`}
        >
          <p className={`text-xs ${report.missingCount > 0 ? 'text-red-900' : 'text-muted-foreground'}`}>
            Не найдено
          </p>
          <p className={`text-lg font-bold tabular-nums ${report.missingCount > 0 ? 'text-red-900' : ''}`}>
            {report.missingCount}
          </p>
        </div>
        <div className="rounded-md border border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">Не на месте</p>
          <p className="text-lg font-bold tabular-nums">{report.misplaced.length}</p>
        </div>
      </div>

      {report.shelves.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {report.shelves.map((s) => {
            const done = s.expected > 0 && s.found >= s.expected;
            return (
              <span
                key={s.shelfId}
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  done
                    ? 'bg-emerald-100 text-emerald-900'
                    : s.found > 0
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {s.shelfName} {s.found}/{s.expected}
              </span>
            );
          })}
        </div>
      )}

      {!compact && report.missingCount > 0 && (
        <div className="rounded-md border border-red-300">
          <div className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5">
            <Icon name="TriangleAlert" size={16} className="text-red-600" />
            <span className="text-sm font-semibold text-red-900">
              Не найдено: {report.missingCount}
            </span>
            <Badge variant="destructive" className="ml-auto">
              спишутся после подтверждения
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">Стикер</TableHead>
                <TableHead className="h-8">Товар</TableHead>
                <TableHead className="h-8">Заказ</TableHead>
                <TableHead className="h-8">Полка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.missing.map((m) => (
                <TableRow key={m.barcode}>
                  <TableCell className="py-1.5 font-mono-tech text-xs">{m.barcode}</TableCell>
                  <TableCell className="py-1.5">{m.product || '—'}</TableCell>
                  <TableCell className="py-1.5">{m.orderNumber || '—'}</TableCell>
                  <TableCell className="py-1.5">{m.shelfName || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!compact && report.misplaced.length > 0 && (
        <div className="rounded-md border border-amber-300">
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900">
            Не на своей полке: {report.misplaced.length}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">Стикер</TableHead>
                <TableHead className="h-8">Товар</TableHead>
                <TableHead className="h-8">Была</TableHead>
                <TableHead className="h-8">Найдена</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.misplaced.map((m) => (
                <TableRow key={m.barcode}>
                  <TableCell className="py-1.5 font-mono-tech text-xs">{m.barcode}</TableCell>
                  <TableCell className="py-1.5">{m.product || '—'}</TableCell>
                  <TableCell className="py-1.5">{m.expectedShelfName || '—'}</TableCell>
                  <TableCell className="py-1.5 font-medium">{m.shelfName || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!compact && report.extra.length > 0 && (
        <div className="rounded-md border border-border">
          <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-sm font-semibold">
            Излишки: {report.extra.length}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8">Стикер</TableHead>
                <TableHead className="h-8">Товар</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.extra.map((m) => (
                <TableRow key={m.barcode}>
                  <TableCell className="py-1.5 font-mono-tech text-xs">{m.barcode}</TableCell>
                  <TableCell className="py-1.5">{m.product || '—'}</TableCell>
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
