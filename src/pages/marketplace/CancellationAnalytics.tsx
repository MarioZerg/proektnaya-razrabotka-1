import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  fetchCancellationReport,
  downloadCancellationExcel,
  type CancellationReport,
} from '@/lib/cancellationAnalyticsApi';

const PERIODS = [
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 180, label: 'Полгода' },
];

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';

/**
 * Анализ отмен на маркетплейсе.
 *
 * Зачем: конкуренты заказывают товар и не выкупают его — производство шьёт впустую.
 *
 * Чего здесь СОЗНАТЕЛЬНО нет: покупателей. Маркетплейсы не передают продавцу
 * персональные данные и не дают связать два заказа одним человеком — проверено
 * запросом к площадке, поля покупателя приходят пустыми. Поэтому «не выкупил ни
 * разу» и «заказывает на разные адреса» посчитать не из чего, и выдумывать это
 * нельзя: с такими цифрами пошли бы в поддержку площадки.
 *
 * Что здесь есть: закономерности, видимые в наших же данных, и номера отправлений.
 * По этим номерам поддержка маркетплейса находит покупателя на своей стороне — это
 * ровно то, что она просит приложить к обращению.
 */
const CancellationAnalytics = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [days, setDays] = useState(30);
  const [minItems, setMinItems] = useState(2);
  const [data, setData] = useState<CancellationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    fetchCancellationReport(days, minItems)
      .then(setData)
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить отчёт',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  }, [days, minItems, isAdmin, toast]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadCancellationExcel(days, minItems);
      toast({ title: 'Файл скачан', description: 'Приложите его к обращению в поддержку' });
    } catch (e) {
      toast({
        title: 'Не удалось сформировать файл',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-muted-foreground">Раздел доступен только администратору.</p>
      </CrmLayout>
    );
  }

  const s = data?.summary;

  return (
    <CrmLayout>
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Анализ отмен</h1>

        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p.days}
              size="sm"
              variant={days === p.days ? 'default' : 'outline'}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </Button>
          ))}
          <div className="mx-2 h-5 w-px bg-border" />
          <Button
            size="sm"
            variant={minItems === 2 ? 'default' : 'outline'}
            onClick={() => setMinItems(2)}
          >
            От 2 отмен
          </Button>
          <Button
            size="sm"
            variant={minItems === 3 ? 'default' : 'outline'}
            onClick={() => setMinItems(3)}
          >
            От 3 отмен
          </Button>
          <div className="ml-auto">
            <Button onClick={exportExcel} disabled={exporting || !data?.orders.length}>
              <Icon
                name={exporting ? 'Loader2' : 'FileSpreadsheet'}
                size={16}
                className={`mr-2 ${exporting ? 'animate-spin' : ''}`}
              />
              Скачать Excel
            </Button>
          </div>
        </div>

        {loading && <p className="text-muted-foreground">Загружаю…</p>}

        {!loading && s && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-muted-foreground">Заказов с отменами</p>
                  <p className="text-2xl font-bold">{s.ordersWithCancels}</p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-muted-foreground">Отменено вещей</p>
                  <p className="text-2xl font-bold">{s.cancelledItems}</p>
                </CardContent>
              </Card>
              <Card className="border-amber-300 bg-amber-50 shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-amber-900">Массовые отмены</p>
                  <p className="text-2xl font-bold text-amber-900">{s.massCancels}</p>
                  <p className="text-xs text-amber-800">3+ вещи в одном заказе</p>
                </CardContent>
              </Card>
              <Card className="border-rose-300 bg-rose-50 shadow-none">
                <CardContent className="py-4">
                  <p className="text-sm text-rose-900">Отмены сразу</p>
                  <p className="text-2xl font-bold text-rose-900">{s.instantCancels}</p>
                  <p className="text-xs text-rose-800">в течение часа после заказа</p>
                </CardContent>
              </Card>
            </div>

            {/* Прямо говорим админу, что этот отчёт НЕ доказывает и почему.
                Иначе цифры легко принять за приговор покупателю. */}
            <Card className="border-sky-200 bg-sky-50 shadow-none">
              <CardContent className="py-3 text-sm text-sky-900">
                Маркетплейсы не передают продавцу данные покупателей, поэтому связать
                заказы одним человеком мы не можем. Отчёт показывает закономерности и
                номера отправлений — по ним поддержка площадки находит покупателя сама.
                Отмена не всегда означает недобросовестность: выводы делает маркетплейс.
              </CardContent>
            </Card>

            {data?.products.length ? (
              <div className="space-y-2">
                <h2 className="font-bold">Товары, по которым отменяют чаще всего</h2>
                <div className="flex flex-wrap gap-2">
                  {data.products.map((p) => (
                    <Badge key={p.product} variant="outline" className="text-sm font-normal">
                      {p.product}: {p.cancelledItems} шт. в {p.orders} заказах
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <h2 className="font-bold">Заказы с отменами</h2>
              {!data?.orders.length ? (
                <p className="text-muted-foreground">
                  За выбранный период таких заказов нет
                </p>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Заказ OZON</TableHead>
                        <TableHead className="text-center">Отменено</TableHead>
                        <TableHead>Товары</TableHead>
                        <TableHead className="text-center">Заказан</TableHead>
                        <TableHead className="text-center">Отменён</TableHead>
                        <TableHead>На что обратить внимание</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.orders.map((o) => (
                        <TableRow key={o.orderKey}>
                          <TableCell className="font-medium">{o.orderKey}</TableCell>
                          <TableCell className="text-center font-bold">
                            {o.cancelledItems}
                          </TableCell>
                          <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                            {o.products}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {fmtDate(o.firstCreated)}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {fmtDate(o.lastCancelled)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {o.flags.map((f) => (
                                <Badge
                                  key={f}
                                  variant="outline"
                                  className={
                                    f.startsWith('Отмена сразу')
                                      ? 'border-rose-300 bg-rose-50 text-rose-900'
                                      : 'border-amber-300 bg-amber-50 text-amber-900'
                                  }
                                >
                                  {f}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default CancellationAnalytics;
