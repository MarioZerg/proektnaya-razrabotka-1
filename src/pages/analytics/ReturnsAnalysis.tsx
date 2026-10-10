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
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

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
  const [listError, setListError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchReturnsReport(Number(days))
      .then((data) => {
        setListError(null);
        setBySewer(data.bySewer);
        setReasons(data.reasons);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить отчёт');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const totalReturns = bySewer.reduce((sum, r) => sum + r.total, 0);
  const totalUtilized = bySewer.reduce((sum, r) => sum + r.utilized, 0);

  return (
    <CrmLayout>
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">Анализ возвратов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              У кого чаще возвращают товар и по каким причинам. Утилизация — убыток:
              вещь выходит из оборота и в остатках больше не считается
            </p>
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-11 w-full sm:h-10 sm:w-[180px]">
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

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2">
          <Card className="border-border shadow-none">
            <CardContent className="flex flex-col gap-0.5 px-3 py-3 sm:flex-row sm:items-center sm:gap-2 sm:px-4">
              <Icon name="Undo2" size={18} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground sm:text-sm">Всего возвратов</span>
              <span className="text-lg font-bold">{totalReturns}</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="flex flex-col gap-0.5 px-3 py-3 sm:flex-row sm:items-center sm:gap-2 sm:px-4">
              <Icon name="Trash2" size={18} className="text-destructive" />
              <span className="text-xs text-muted-foreground sm:text-sm">Убыток, шт.</span>
              <span className="text-lg font-bold">{totalUtilized}</span>
            </CardContent>
          </Card>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить отчёт"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && bySewer.length === 0 && reasons.length === 0 ? (
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
                  listError ? null : (
                  <p className="p-4 text-sm text-muted-foreground">
                    За выбранный период возвратов не было
                  </p>
                  )
                ) : (
                  <>
                    <div className="space-y-2 p-3 lg:hidden">
                      {bySewer.map((r) => (
                        <div
                          key={`${r.sewerName}-${r.cutterName}`}
                          className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
                        >
                          <p className="break-words font-semibold leading-snug">{r.sewerName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Закройщик: {r.cutterName || '—'}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                            <span className="text-muted-foreground">Отшито</span>
                            <span className="text-right tabular-nums">{r.madeTotal || '—'}</span>
                            <span className="text-muted-foreground">Вернулось</span>
                            <span className="text-right font-medium tabular-nums">{r.total}</span>
                            <span className="text-muted-foreground">% возвратов</span>
                            <span className="text-right">
                              {r.returnRate === null ? (
                                '—'
                              ) : (
                                <Badge
                                  variant={
                                    r.returnRate >= HIGH_RETURN_RATE ? 'destructive' : 'secondary'
                                  }
                                >
                                  {r.returnRate}%
                                </Badge>
                              )}
                            </span>
                            <span className="text-muted-foreground">Убыток</span>
                            <span
                              className={`text-right tabular-nums ${
                                r.utilized > 0 ? 'font-medium text-destructive' : ''
                              }`}
                            >
                              {r.utilized}
                            </span>
                            <span className="text-muted-foreground">Перепаковка</span>
                            <span className="text-right tabular-nums">{r.repack}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden lg:block">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-primary hover:bg-primary">
                            <TableHead className="text-primary-foreground">Швея</TableHead>
                            <TableHead className="text-primary-foreground">Закройщик</TableHead>
                            <TableHead className="text-primary-foreground">Отшито</TableHead>
                            <TableHead className="text-primary-foreground">Вернулось</TableHead>
                            <TableHead className="text-primary-foreground">% возвратов</TableHead>
                            <TableHead className="text-primary-foreground">Убыток</TableHead>
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
                                    variant={
                                      r.returnRate >= HIGH_RETURN_RATE ? 'destructive' : 'secondary'
                                    }
                                  >
                                    {r.returnRate}%
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell
                                className={r.utilized > 0 ? 'font-medium text-destructive' : ''}
                              >
                                {r.utilized}
                              </TableCell>
                              <TableCell>{r.repack}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
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
