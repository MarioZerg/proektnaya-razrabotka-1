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

/** Сколько дней осталось до конца холда. */
const daysLeft = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
};

/**
 * Начисления менеджера маркетплейсов: процент с проданных вещей.
 *
 * Как считается. Раз в неделю площадка закрывает отчёт и переводит деньги на
 * расчётный счёт. С ЭТИХ денег — а не с оборота — начисляется процент: комиссию
 * площадки, логистику и услуги мы не получаем, платить с них не с чего.
 *
 * Каждое начисление держится 15 дней. За это время покупатель может вернуть
 * товар: тогда доля вернувшихся вещей снимается. Если вернул позже — деньги
 * остаются у менеджера, так и договаривались.
 */
interface Props {
  userId: number;
  /** Режим владельца: показывает кнопку выплаты по каждому отчёту. */
  canPay?: boolean;
}

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
        {data.hold > 0 && (
          <Card className="border-border shadow-none">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">На проверке</p>
              <p className="mt-1 text-2xl font-bold">{money(data.hold)} ₽</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ждёт {data.holdDays} дней
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
            const left = daysLeft(a.holdUntil);
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
                    <p className="text-sm font-medium">
                      {dmy(a.periodStart)} — {dmy(a.periodEnd)}
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
                    {a.compensation > 0 && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-emerald-700">
                        <Icon name="Gift" size={12} className="shrink-0" />
                        из них {money(a.compensation)} ₽ — компенсации площадки
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
                    {a.status === 'hold' && (
                      <p className="text-xs text-muted-foreground">
                        на проверке ещё {left} дн
                      </p>
                    )}
                    {a.status === 'confirmed' && (
                      <p className="text-xs text-emerald-700">подтверждено</p>
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
