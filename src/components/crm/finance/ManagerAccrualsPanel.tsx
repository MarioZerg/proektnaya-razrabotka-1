import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  fetchManagerBalance,
  type ManagerBalance,
} from '@/lib/managerFinanceApi';

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
const ManagerAccrualsPanel = ({ userId }: { userId: number }) => {
  const [data, setData] = useState<ManagerBalance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchManagerBalance(userId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [userId]);

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
              Проверено, выплата 10 и 25 числа через кассу
            </p>
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">На проверке</p>
            <p className="mt-1 text-2xl font-bold">{money(data.hold)} ₽</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ждёт {data.holdDays} дней: если покупатель вернёт товар, сумма
              уменьшится
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <Icon name="ReceiptText" size={15} />
            Отчёты по неделям
            <Badge variant="secondary">{data.percent}% с перечислений</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Процент считается с денег, пришедших на расчётный счёт за неделю
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
                  </div>
                </div>

                {/* Возвраты показываем строкой, а не молча уменьшаем сумму:
                    иначе человек видит другое число и не понимает причину. */}
                {a.returnedUnits > 0 && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700">
                    <Icon name="Undo2" size={12} className="shrink-0" />
                    покупатели вернули {a.returnedUnits} шт — снято{' '}
                    {money(a.returnedAmount)} ₽ из {money(a.amount)} ₽
                  </p>
                )}

                {a.cancelReason && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                    <Icon name="CircleX" size={12} className="mt-0.5 shrink-0" />
                    {a.cancelReason}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

export default ManagerAccrualsPanel;
