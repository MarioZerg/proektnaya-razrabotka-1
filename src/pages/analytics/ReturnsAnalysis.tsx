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
import {
  fetchReturnsReport,
  type ReturnsBySewer,
  type ReturnReasonStat,
} from '@/lib/marketplaceReturnsApi';

/** Процент возвратов, выше которого стоит разбираться с качеством пошива. */
const HIGH_RETURN_RATE = 5;

/** Отчёт по возвратам: у кого чаще возвращают товар и по каким причинам. Сравнивать швей
 * можно только с учётом объёма — поэтому рядом с числом возвратов всегда видно, сколько
 * человек отшил за период. */
const ReturnsAnalysis = () => {
  const [bySewer, setBySewer] = useState<ReturnsBySewer[]>([]);
  const [reasons, setReasons] = useState<ReturnReasonStat[]>([]);
  const [days, setDays] = useState('90');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchReturnsReport(Number(days))
      .then((data) => {
        setBySewer(data.bySewer);
        setReasons(data.reasons);
      })
      .finally(() => setLoading(false));
  }, [days]);

  const totalReturns = bySewer.reduce((sum, r) => sum + r.total, 0);
  const totalUtilized = bySewer.reduce((sum, r) => sum + r.utilized, 0);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Анализ возвратов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              У кого чаще возвращают товар и по каким причинам
            </p>
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">За 30 дней</SelectItem>
              <SelectItem value="90">За 90 дней</SelectItem>
              <SelectItem value="180">За полгода</SelectItem>
              <SelectItem value="365">За год</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="Undo2" size={18} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Всего возвратов</span>
              <span className="text-lg font-bold">{totalReturns}</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="Trash2" size={18} className="text-destructive" />
              <span className="text-sm text-muted-foreground">Утилизировано</span>
              <span className="text-lg font-bold">{totalUtilized}</span>
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
            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Возвраты по швеям</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {bySewer.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    За выбранный период возвратов не было
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary hover:bg-primary">
                        <TableHead className="text-primary-foreground">Швея</TableHead>
                        <TableHead className="text-primary-foreground">Закройщик</TableHead>
                        <TableHead className="text-primary-foreground">Отшито</TableHead>
                        <TableHead className="text-primary-foreground">Вернулось</TableHead>
                        <TableHead className="text-primary-foreground">% возвратов</TableHead>
                        <TableHead className="text-primary-foreground">Утилизировано</TableHead>
                        <TableHead className="text-primary-foreground">Перепаковка</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bySewer.map((r) => (
                        <TableRow key={`${r.sewerName}-${r.cutterName}`}>
                          <TableCell className="font-medium">{r.sewerName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.cutterName}
                          </TableCell>
                          <TableCell>{r.madeTotal || '—'}</TableCell>
                          <TableCell className="font-medium">{r.total}</TableCell>
                          <TableCell>
                            {r.returnRate === null ? (
                              '—'
                            ) : (
                              <Badge
                                variant={r.returnRate >= HIGH_RETURN_RATE ? 'destructive' : 'secondary'}
                              >
                                {r.returnRate}%
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className={r.utilized > 0 ? 'font-medium text-destructive' : ''}>
                            {r.utilized}
                          </TableCell>
                          <TableCell>{r.repack}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="border-border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Почему возвращают</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {reasons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Причин пока нет</p>
                ) : (
                  reasons.map((r) => (
                    <div
                      key={r.reason}
                      className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
                    >
                      <p className="text-sm">{r.reason}</p>
                      <Badge variant="secondary" className="shrink-0">
                        {r.count}
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

export default ReturnsAnalysis;
