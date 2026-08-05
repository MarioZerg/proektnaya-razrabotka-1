import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { fetchDefectReport, type DefectReport } from '@/lib/kioskApi';
import { formatQuantity } from '@/lib/formatQuantity';

const roleLabel: Record<string, string> = {
  sewer: 'Швея',
  cutter: 'Закройщик',
  packer: 'Упаковщик',
  storekeeper: 'Кладовщик',
  admin: 'Администратор',
};

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  const names = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ];
  return `${names[Number(m) - 1] || m} ${y}`;
};

/**
 * Анализ брака материалов.
 *
 * Главный вопрос отчёта — не «кто много бракует», а «кто брак не оформляет». Брак попадается
 * всем, и пустая строка у сотрудника обычно значит, что он молча выбрасывает обрезки, а не
 * работает идеально. Поэтому отдельным блоком показываем тех, у кого за период нет ни одной
 * записи.
 */
const DefectAnalysis = () => {
  const [report, setReport] = useState<DefectReport | null>(null);
  const [months, setMonths] = useState('6');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchDefectReport(Number(months))
      .then(setReport)
      .finally(() => setLoading(false));
  }, [months]);

  const totalQty = report?.byUser.reduce((s, r) => s + r.quantity, 0) || 0;
  const totalCount = report?.byUser.reduce((s, r) => s + r.count, 0) || 0;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Анализ брака</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Брак ткани и тесьмы по сотрудникам и причинам
            </p>
          </div>
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">За 3 месяца</SelectItem>
              <SelectItem value="6">За полгода</SelectItem>
              <SelectItem value="12">За год</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="PackageX" size={18} className="text-destructive" />
              <span className="text-sm text-muted-foreground">Всего брака</span>
              <span className="text-lg font-bold">
                {formatQuantity(totalQty)} пог.м. · {totalCount} шт.
              </span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="Truck" size={18} className="text-amber-600" />
              <span className="text-sm text-muted-foreground">Ждёт приёмки на склад</span>
              <span className="text-lg font-bold">{report?.pendingCount || 0} шт.</span>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            {report && report.neverReported.length > 0 && (
              <Card className="border-amber-300 bg-amber-50 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                    <Icon name="TriangleAlert" size={18} />
                    Не оформляли брак ни разу: {report.neverReported.length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-2 text-sm text-amber-900">
                    Брак попадается всем. Если записей нет совсем — скорее всего, обрезки
                    выбрасывают молча. Стоит проверить.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {report.neverReported.map((u) => (
                      <Badge key={u.userName} variant="outline" className="border-amber-400">
                        {u.userName} · {roleLabel[u.role] || u.role}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Брак по сотрудникам и месяцам</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!report || report.byUser.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    За выбранный период брак не оформляли
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">Месяц</TableHead>
                        <TableHead className="text-primary-foreground">Сотрудник</TableHead>
                        <TableHead className="text-primary-foreground">Роль</TableHead>
                        <TableHead className="text-primary-foreground">Записей</TableHead>
                        <TableHead className="text-primary-foreground">Метраж</TableHead>
                        <TableHead className="text-primary-foreground">Не сдано на склад</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.byUser.map((r) => (
                        <TableRow key={`${r.month}-${r.userName}`}>
                          <TableCell>{monthLabel(r.month)}</TableCell>
                          <TableCell className="font-medium">{r.userName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {roleLabel[r.role] || r.role}
                          </TableCell>
                          <TableCell>{r.count}</TableCell>
                          <TableCell className="font-medium">
                            {formatQuantity(r.quantity)}
                          </TableCell>
                          <TableCell>
                            {r.pending > 0 ? (
                              <Badge variant="destructive">{r.pending}</Badge>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Причины брака</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!report || report.byReason.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Данных пока нет</p>
                ) : (
                  report.byReason.map((r) => (
                    <div
                      key={r.reason}
                      className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0"
                    >
                      <span className="text-sm">{r.reason}</span>
                      <Badge variant="secondary">
                        {formatQuantity(r.quantity)} пог.м. · {r.count} шт.
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default DefectAnalysis;
