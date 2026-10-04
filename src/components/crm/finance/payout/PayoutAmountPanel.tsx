import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { PayoutPreview } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface PayoutAmountPanelProps {
  loading: boolean;
  error: string;
  preview: PayoutPreview | null;
  wholePeriod: boolean;
  fullAmount: number;
  payAmount: string;
  setPayAmount: (v: string) => void;
  amountValid: boolean;
  restToNextPeriod: number;
  /** Выдали больше начисленного — разница удержится из следующей выплаты. */
  overPaid: number;
  accrued: number;
  willRepay: number;
  notEnough: boolean;
}

/** Сумма к выплате: расчёт, частичная выплата и все предупреждения. */
const PayoutAmountPanel = ({
  loading,
  error,
  preview,
  wholePeriod,
  fullAmount,
  payAmount,
  setPayAmount,
  amountValid,
  restToNextPeriod,
  overPaid,
  accrued,
  willRepay,
  notEnough,
}: PayoutAmountPanelProps) => (
  <div className="min-w-0 overflow-hidden rounded-md border border-border p-3 text-sm">
    {loading ? (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon name="Loader2" size={14} className="animate-spin" />
        Считаю сумму...
      </div>
    ) : error ? (
      /* Запрос не прошёл. Молчаливый ноль здесь опаснее ошибки:
         по нему решают, что человеку платить нечего. */
      <div className="flex min-w-0 items-start gap-2 text-sm text-destructive">
        <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          Не удалось посчитать сумму: {error}
          <span className="mt-1 block text-xs text-muted-foreground">
            Обновите страницу или войдите заново — начисления никуда не делись
          </span>
        </span>
      </div>
    ) : (
      <>
        <p className="text-muted-foreground">
          {wholePeriod
            ? 'Весь невыплаченный остаток'
            : 'К выплате за выбранный период'}
        </p>
        <p className="break-all text-lg font-bold tabular-nums">{formatMoney(fullAmount)} ₽</p>

        {/* ВЫПЛАТА КРУГЛОЙ СУММОЙ — В ЛЮБУЮ СТОРОНУ.
            Зарплату выдают наличными и переводом без копеек: к выплате
            12 480,50 ₽, а на руки идёт 12 500 ₽ или 12 000 ₽. Недоплата
            остаётся за сотрудником, переплата удержится из следующей
            выплаты — держать разницу в голове не нужно. */}
        {fullAmount > 0 && (
          <div className="mt-3 min-w-0 border-t border-border pt-3">
            <Label className="text-xs leading-snug text-muted-foreground">
              Выплатить сейчас — можно округлить в любую сторону
            </Label>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
              <Input
                inputMode="decimal"
                placeholder={fullAmount.toFixed(2)}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="h-11 w-full min-w-0 flex-1 basis-[8rem] sm:h-9 sm:max-w-[10rem]"
              />
              <span className="shrink-0 text-sm text-muted-foreground">₽</span>
              {payAmount.trim() && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  onClick={() => setPayAmount('')}
                >
                  Всю сумму
                </Button>
              )}
            </div>

            {/* Округление в один клик: вручную набирать круглое число
                каждому сотруднику — та же рутина, от которой уходим. */}
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="w-full text-[11px] text-muted-foreground sm:w-auto">
                Округлить:
              </span>
              {[100, 500, 1000].map((step) => {
                const down = Math.floor(fullAmount / step) * step;
                const up = Math.ceil(fullAmount / step) * step;
                return (
                  <span key={step} className="flex max-w-full flex-wrap gap-1">
                    {down > 0 && down !== fullAmount && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-full px-2 text-[11px] tabular-nums"
                        onClick={() => setPayAmount(String(down))}
                      >
                        {formatMoney(down)}
                      </Button>
                    )}
                    {up !== fullAmount && up !== down && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-full px-2 text-[11px] tabular-nums"
                        onClick={() => setPayAmount(String(up))}
                      >
                        {formatMoney(up)}
                      </Button>
                    )}
                  </span>
                );
              })}
            </div>

            {/* Ошибку показываем сразу, а не отказом сервера после
                нажатия: админ должен понять причину, пока правит. */}
            {!amountValid && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                <Icon
                  name="TriangleAlert"
                  size={12}
                  className="mt-0.5 shrink-0"
                />
                Сумма должна быть больше нуля
              </p>
            )}

            {restToNextPeriod > 0 && (
              <p className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-md bg-blue-50 p-2 text-xs text-blue-900">
                <Icon
                  name="ArrowRight"
                  size={12}
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0 break-words">
                  На следующий период перейдёт{' '}
                  <b>{formatMoney(restToNextPeriod)} ₽</b> — сумма останется
                  за сотрудником и сама войдёт в ближайшую выплату
                </span>
              </p>
            )}

            {/* Выдали больше начисленного. Это не ошибка, а обычное
                округление вверх: разница станет удержанием и уменьшит
                ближайшую следующую выплату. */}
            {overPaid > 0 && (
              <p className="mt-1.5 flex min-w-0 items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                <Icon
                  name="Undo2"
                  size={12}
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0 break-words">
                  Выдаём на <b>{formatMoney(overPaid)} ₽</b> больше начисленного
                  — эта сумма удержится из следующей выплаты сотрудника
                </span>
              </p>
            )}
          </div>
        )}
        {!!preview && preview.count > 0 && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {preview.count} начислений
            {preview.firstDate &&
              preview.lastDate &&
              ` · ${preview.firstDate} — ${preview.lastDate}`}
          </p>
        )}
        {/* Ноль без объяснения читается как поломка. Говорим прямо:
            в этих датах начислений нет — либо их уже выплатили,
            либо работа записана другими днями. */}
        {!!preview && preview.count === 0 && (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">
            {wholePeriod
              ? 'Невыплаченных начислений нет — всё уже выплачено'
              : 'В выбранных датах невыплаченных начислений нет: возможно, период уже закрыт выплатой или работа записана другими днями. Нажмите «Всё целиком», чтобы увидеть остаток.'}
          </p>
        )}
        {/* Расшифровка, когда часть заработка ушла на долги: без неё
            админ видит сумму меньше ожидаемой и не понимает почему. */}
        {willRepay > 0 && (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            Начислено {formatMoney(accrued)} ₽ − удержано{' '}
            {formatMoney(willRepay)} ₽
          </p>
        )}
        {/* Денег в кассе может не хватить — сказать об этом надо
            здесь, а не после нажатия отказом от сервера. */}
        {notEnough && preview && (
          <p className="mt-1.5 flex min-w-0 items-start gap-1.5 text-xs text-destructive">
            <Icon
              name="TriangleAlert"
              size={12}
              className="mt-0.5 shrink-0"
            />
            <span className="min-w-0 break-words">
              В кассе только {formatMoney(preview.cashBalance)} ₽ — пополните
              кассу перед выплатой
            </span>
          </p>
        )}
      </>
    )}
  </div>
);

export default PayoutAmountPanel;