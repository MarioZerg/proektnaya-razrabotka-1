import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  fetchManagerBalance,
  type ManagerAccrual,
  type ManagerBalance,
} from '@/lib/managerFinanceApi';
import { printManagerReport } from '@/lib/printManagerReport';
import { payManagerAccrual } from '@/lib/managerFinanceApi';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';

const money = (v: number) => Math.round(v).toLocaleString('ru-RU');

const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y.slice(2)}`;
};

/**
 * Начисления менеджера маркетплейсов: процент с проданных вещей.
 *
 * Как считается. Раз в неделю площадка закрывает отчёт и переводит деньги на
 * расчётный счёт. С ЭТИХ денег — а не с оборота — начисляется процент: комиссию
 * площадки, логистику и услуги мы не получаем, платить с них не с чего.
 *
 * Срока проверки у начисления нет. Возвраты площадка вычитает сама, ещё в
 * своём отчёте: сумма к перечислению приходит уже за их вычетом. Держать
 * деньги второй раз — значит удержать с менеджера дважды за один возврат.
 *
 * Единственное ожидание — поступление денег от площадки: пока они на её
 * балансе, платить не с чего.
 *
 * Закрытый отчёт не пересматривается. Он посчитан по ценам и себестоимости
 * той недели: если позже цены опустят и товар станет убыточным, это уже
 * другой период работы — удерживать деньги задним числом нельзя.
 */
interface Props {
  userId: number;
  /** Режим владельца: показывает кнопку выплаты по каждому отчёту. */
  canPay?: boolean;
}

/** Названия площадок: в отчётах они приходят кодом. */
const MARKETPLACE_LABEL: Record<string, string> = {
  ozon: 'OZON',
  wildberries: 'Wildberries',
  yandex_market: 'Яндекс Маркет',
};

const ManagerAccrualsPanel = ({ userId, canPay = false }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<ManagerBalance | null>(null);
  const [loading, setLoading] = useState(true);
  // Какой отчёт сейчас собирается: сборка занимает секунду-другую, и без
  // отметки человек жмёт кнопку повторно.
  const [busyId, setBusyId] = useState<number | null>(null);

  // Выплата по конкретному отчёту: вознаграждение уходит в зарплату и
  // дальше проходит через кассу вместе с оплатой труда цеха.
  const [payingId, setPayingId] = useState<number | null>(null);

  const pay = async (a: ManagerAccrual) => {
    setPayingId(a.id);
    try {
      await payManagerAccrual(a.id, user?.id);
      toast({
        title: 'Передано в зарплату',
        description: `${money(a.net)} ₽ за ${dmy(a.periodStart)} — ${dmy(a.periodEnd)}`,
      });
      await load(true);
    } catch (e) {
      toast({
        title: 'Не удалось выплатить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPayingId(null);
    }
  };

  const download = async (a: ManagerAccrual) => {
    setBusyId(a.id);
    try {
      await printManagerReport(a, user?.name || 'Менеджер маркетплейсов');
    } catch (e) {
      toast({
        title: 'Не удалось собрать отчёт',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setData(await fetchManagerBalance(userId));
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загружаю начисления...
        </CardContent>
      </Card>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="space-y-1.5 py-6 text-sm text-muted-foreground">
          <p>
            Начислений пока нет — первое появится, когда площадка закроет
            недельный отчёт в среду
          </p>
          {/* Пустой экран без объяснения выглядит поломкой. Говорим прямо,
              что старые недели считаются вручную, а не потерялись. */}
          {data?.accrueFrom && (
            <p className="text-xs">
              Система считает с {dmy(data.accrueFrom)}. Отчёты за более ранние
              недели сверяются и оплачиваются вручную
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Два числа, ради которых человек сюда заходит: сколько уже заработано
          и сколько ещё может измениться из-за возвратов. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="border-border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">К выплате</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">
              {money(data.confirmed)} ₽
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Выплата 10 и 25 числа через кассу
            </p>
          </CardContent>
        </Card>
        {/* Деньги ещё на балансе площадки. Показываем отдельно от «к выплате»:
            начисление посчитано, но получить его пока не с чего. */}
        {data.pending > 0 && (
          <Card className="border-border shadow-none">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ожидает поступления</p>
              <p className="mt-1 text-2xl font-bold">{money(data.pending)} ₽</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Деньги ещё не пришли от площадки на расчётный счёт
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <Icon name="ReceiptText" size={15} />
            Отчёты по неделям
            <Badge variant="secondary">{data.percent}% с перечислений</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Процент считается с денег, пришедших на расчётный счёт за неделю.
            Отмены и возвраты площадка удерживает сама — они уже вычтены из
            этой суммы
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.items.map((a) => {
            return (
              <div
                key={a.id}
                className={`rounded-lg border p-3 ${
                  a.status === 'cancelled'
                    ? 'border-dashed border-border opacity-70'
                    : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {dmy(a.periodStart)} — {dmy(a.periodEnd)}
                      {/* Площадка: у каждой свои сроки и удержания, без метки
                          отчёты за одну неделю сливаются в одинаковые строки. */}
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {MARKETPLACE_LABEL[a.marketplace] || a.marketplace}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {money(a.baseAmount)} ₽ на счёт · {a.units} шт
                      {a.perUnit != null && ` · ${a.perUnit.toFixed(2)} ₽ за штуку`}
                    </p>
                    {/* Убыточные продажи вычитаются из базы. Сказать об этом
                        надо явно: иначе процент от суммы на счёте не сходится,
                        и человек считает расчёт ошибочным. */}
                    {/* Компенсации площадки — тоже выручка, и процент с них
                        начисляется. Показываем отдельно: иначе непонятно,
                        почему база больше суммы обычных продаж. */}
                    {/* Комиссия за перевод денег: у Яндекса 1,6%. Компания их
                        не получает, поэтому процент считается уже без них. */}
                    {a.withdrawFee > 0 && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon name="Minus" size={12} className="shrink-0" />
                        комиссия площадки за вывод — {money(a.withdrawFee)} ₽
                      </p>
                    )}
                    {a.compensation > 0 && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700">
                        <Icon name="Gift" size={12} className="shrink-0" />
                        из них {money(a.compensation)} ₽ — компенсации площадки
                      </p>
                    )}
                    {/* Маржинальность периода: главный показатель работы
                        менеджера. Пока она есть — товары приносят доход. */}
                    {a.avgMargin != null && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <Icon
                          name="ChartLine"
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="text-muted-foreground">
                          средняя маржа
                        </span>
                        <span
                          className={`font-semibold ${
                            a.avgMargin >= 15
                              ? 'text-emerald-700'
                              : a.avgMargin > 0
                                ? 'text-amber-700'
                                : 'text-destructive'
                          }`}
                        >
                          {a.avgMargin.toFixed(1)}%
                        </span>
                      </p>
                    )}
                    {a.lossUnits > 0 && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-700">
                        <Icon name="TrendingDown" size={12} className="shrink-0" />
                        {a.lossUnits} шт продано ниже себестоимости — из базы
                        вычтено {money(a.lossAmount)} ₽
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-lg font-bold ${
                        a.status === 'cancelled'
                          ? 'text-muted-foreground line-through'
                          : a.status === 'confirmed'
                            ? 'text-emerald-700'
                            : ''
                      }`}
                    >
                      {money(a.net)} ₽
                    </p>
                    {a.status === 'confirmed' && !a.paidAt && (
                      <p className="text-xs text-emerald-700">к выплате</p>
                    )}
                    {a.status === 'pending' && (
                      <p className="text-xs text-muted-foreground">
                        ждёт поступления денег
                      </p>
                    )}
                  </div>
                </div>


                {/* Почему сумма не в балансе. Без объяснения человек видит
                    начисление, но не находит его в «к выплате». */}
                {a.status === 'pending' && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Icon name="Clock" size={12} className="mt-0.5 shrink-0" />
                    Площадка ещё не перевела деньги за эту неделю. Сумма войдёт
                    в баланс автоматически, как только они поступят на счёт
                  </p>
                )}

                {/* Что именно ушло в минус. Сухой вычет ни о чём не говорит:
                    менеджеру нужен список товаров, по которым надо поднять
                    цену или снять их с продажи. */}
                {a.lossDetails?.length > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                    <p className="text-xs font-medium text-amber-900">
                      Проданы ниже себестоимости
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {a.lossDetails.slice(0, 6).map((d) => (
                        <p
                          key={`${d.material}-${d.width}-${d.price}`}
                          className="flex flex-wrap justify-between gap-x-2 text-xs text-amber-900"
                        >
                          <span>
                            {d.material} {d.width} см · по {money(d.price)} ₽ ·{' '}
                            {d.units} шт
                          </span>
                          <span className="font-medium">
                            −{money(d.lossPerUnit)} ₽ с вещи
                          </span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {a.cancelReason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                    <Icon name="CircleX" size={12} className="mt-0.5 shrink-0" />
                    {a.cancelReason}
                  </p>
                )}

                {/* Отчёт собирается в браузере и сразу уходит в загрузки:
                    в нём суммы к выплате, и ссылке на него взяться неоткуда. */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Выплата доступна владельцу и только по подтверждённому
                    отчёту: пока деньги не пришли от площадки, платить не с
                    чего. Выплаченное помечаем, чтобы не заплатить дважды. */}
                {canPay && a.status === 'confirmed' && !a.paidAt && (
                  <Button
                    size="sm"
                    className="h-8 bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => pay(a)}
                    disabled={payingId === a.id}
                  >
                    <Icon
                      name={payingId === a.id ? 'Loader2' : 'Banknote'}
                      size={13}
                      className={`mr-1.5 ${payingId === a.id ? 'animate-spin' : ''}`}
                    />
                    Выплатить {money(a.net)} ₽
                  </Button>
                )}
                {a.paidAt && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <Icon name="CircleCheck" size={13} />
                    выплачено
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => download(a)}
                  disabled={busyId === a.id}
                >
                  <Icon
                    name={busyId === a.id ? 'Loader2' : 'Download'}
                    size={13}
                    className={`mr-1.5 ${busyId === a.id ? 'animate-spin' : ''}`}
                  />
                  Скачать отчёт PDF
                </Button>
                </div>

              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default ManagerAccrualsPanel;
