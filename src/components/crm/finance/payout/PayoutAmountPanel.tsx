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
  accrued,
  willRepay,
  notEnough,
}: PayoutAmountPanelProps) => (
  <div className="rounded-md border border-border p-3 text-sm">
    {loading ? (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon name="Loader2" size={14} className="animate-spin" />
        Считаю сумму...
      </div>
    ) : error ? (
      /* Запрос не прошёл. Молчаливый ноль здесь опаснее ошибки:
         по нему решают, что человеку платить нечего. */
      <div className="flex items-start gap-2 text-sm text-destructive">
        <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
        <span>
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
        <p className="text-lg font-bold">{formatMoney(fullAmount)} ₽</p>

        {/* ЧАСТИЧНАЯ ВЫПЛАТА.
            Денег в кассе хватило не на всё, договорились выдать
            часть — вводим сумму здесь. Разница не теряется и не
            требует памяти бухгалтера: она остаётся невыплаченной
            и сама войдёт в следующий расчёт. */}
        {fullAmount > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <Label className="text-xs text-muted-foreground">
              Выплатить сейчас (можно меньше — остаток перейдёт в следующий
              период)
            </Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                inputMode="decimal"
                placeholder={fullAmount.toFixed(2)}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="h-9 w-40"
              />
              <span className="text-sm text-muted-foreground">₽</span>
              {payAmount.trim() && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setPayAmount('')}
                >
                  Всю сумму
                </Button>
              )}
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
                Сумма должна быть больше нуля и не больше{' '}
                {formatMoney(fullAmount)} ₽. Чтобы выдать сверх заработанного,
                оформите аванс отдельным начислением
              </p>
            )}

            {restToNextPeriod > 0 && (
              <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-blue-50 p-2 text-xs text-blue-900">
                <Icon
                  name="ArrowRight"
                  size={12}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  На следующий период перейдёт{' '}
                  <b>{formatMoney(restToNextPeriod)} ₽</b> — сумма останется
                  за сотрудником и сама войдёт в ближайшую выплату
                </span>
              </p>
            )}
          </div>
        )}
        {!!preview && preview.count > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
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
          <p className="mt-0.5 text-xs text-muted-foreground">
            {wholePeriod
              ? 'Невыплаченных начислений нет — всё уже выплачено'
              : 'В выбранных датах невыплаченных начислений нет: возможно, период уже закрыт выплатой или работа записана другими днями. Нажмите «Всё целиком», чтобы увидеть остаток.'}
          </p>
        )}
        {/* Расшифровка, когда часть заработка ушла на долги: без неё
            админ видит сумму меньше ожидаемой и не понимает почему. */}
        {willRepay > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Начислено {formatMoney(accrued)} ₽ − удержано{' '}
            {formatMoney(willRepay)} ₽
          </p>
        )}
        {/* Денег в кассе может не хватить — сказать об этом надо
            здесь, а не после нажатия отказом от сервера. */}
        {notEnough && preview && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
            <Icon
              name="TriangleAlert"
              size={12}
              className="mt-0.5 shrink-0"
            />
            В кассе только {formatMoney(preview.cashBalance)} ₽ — пополните
            кассу перед выплатой
          </p>
        )}
      </>
    )}
  </div>
);

export default PayoutAmountPanel;
