import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import { fetchReprintReport, type ReprintReport } from '@/lib/kioskApi';

interface ReprintReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const periods = [
  { days: 7, label: 'Неделя' },
  { days: 30, label: 'Месяц' },
  { days: 90, label: '3 месяца' },
];

/** Отчёт админу: сколько стикеров хранения пришлось перепечатывать кладовщику и по чьей вине
 * (упаковщик, который должен был наклеить стикер на товар в цехе). */
const ReprintReportDialog = ({ open, onOpenChange }: ReprintReportDialogProps) => {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<ReprintReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchReprintReport(days)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [open, days]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Пропущенные стикеры хранения</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Сколько раз кладовщику пришлось печатать стикер заново, потому что на товаре его не
            оказалось. Виновным считается упаковщик, закрывавший заказ.
          </p>

          <div className="flex gap-2">
            {periods.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant={days === p.days ? 'default' : 'outline'}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Загрузка...
            </div>
          ) : !report || report.total === 0 ? (
            <div className="py-8 text-center">
              <Icon name="CircleCheck" size={44} className="mx-auto text-emerald-600" />
              <p className="mt-3 font-semibold">Все стикеры на месте</p>
              <p className="mt-1 text-sm text-muted-foreground">
                За выбранный период перепечатывать стикеры не приходилось
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border border-border p-4">
                <div className="text-3xl font-bold">{report.total}</div>
                <div className="text-sm text-muted-foreground">
                  стикеров перепечатано за период
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">По упаковщикам</p>
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">Упаковщик</TableHead>
                        <TableHead className="text-primary-foreground">Пропущено</TableHead>
                        <TableHead className="text-primary-foreground">Последний раз</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.byPacker.map((p) => (
                        <TableRow key={p.packerName}>
                          <TableCell className="font-medium">{p.packerName}</TableCell>
                          <TableCell>
                            <Badge variant={p.count > 2 ? 'destructive' : 'secondary'}>
                              {p.count}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {p.lastAt ? formatDateTime(p.lastAt) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">Последние случаи</p>
                <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">Когда</TableHead>
                        <TableHead className="text-primary-foreground">Заказ</TableHead>
                        <TableHead className="text-primary-foreground">Упаковщик</TableHead>
                        <TableHead className="text-primary-foreground">Швея</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.events.map((e, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDateTime(e.createdAt)}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{e.orderNumber || '—'}</div>
                            <div className="text-xs text-muted-foreground">{e.product}</div>
                          </TableCell>
                          <TableCell>{e.packerName || '—'}</TableCell>
                          <TableCell>{e.sewerName || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReprintReportDialog;
