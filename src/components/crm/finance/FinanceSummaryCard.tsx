import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import BlockSkeleton from '@/components/crm/finance/BlockSkeleton';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface FinanceSummaryCardProps {
  totalToAccrue: number;
  totalDebts: number;
  /** Сумма ВСЕХ невыплаченных удержаний (отрицательная), независимо от заработка. */
  totalPenalties: number;
  penaltiesCount: number;
  penaltiesUsers: number;
  /** Часть удержаний БЕЗ вины: спецодежда, выкуп товара, аванс. */
  totalDeductions: number;
  deductionsCount: number;
  period1Total: number;
  period2Total: number;
  loading: boolean;
  /** Показать штрафы в таблице слева — фильтр по типу «Штрафы». */
  onShowPenalties?: () => void;
}

/** «1 сотрудника», «2 сотрудников» — окончание по числу людей. */
const personWord = (n: number) => {
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 14) return 'сотрудников';
  if (last1 === 1) return 'сотрудника';
  if (last1 >= 2 && last1 <= 4) return 'сотрудников';
  return 'сотрудников';
};

/** Строка метка + сумма: на узкой колонке сумма не уезжает за край. */
const MoneyRow = ({
  label,
  hint,
  amount,
  amountClass = '',
}: {
  label: string;
  hint?: string;
  amount: number;
  amountClass?: string;
}) => (
  <div className="min-w-0">
    <p className="break-words text-muted-foreground">{label}</p>
    {hint ? (
      <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">{hint}</p>
    ) : null}
    <p className={`mt-1 break-all text-xl font-bold tabular-nums ${amountClass}`}>
      {formatMoney(amount)} ₽
    </p>
  </div>
);

const FinanceSummaryCard = ({
  totalToAccrue,
  totalDebts,
  totalPenalties,
  penaltiesCount,
  penaltiesUsers,
  totalDeductions,
  deductionsCount,
  period1Total,
  period2Total,
  loading,
  onShowPenalties,
}: FinanceSummaryCardProps) => {
  // Настоящие штрафы — это всё списанное МИНУС удержания без вины. Складывать
  // их в одну строку нельзя: расчёт за спецодежду выглядел бы нарушением.
  const fines = totalPenalties - totalDeductions;
  const finesCount = penaltiesCount - deductionsCount;

  return (
    <Card className="min-w-0 overflow-hidden border-border shadow-none">
      <CardHeader className="min-w-0 space-y-1">
        <CardTitle className="text-base">Баланс начислений</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 overflow-hidden text-sm">
        {loading ? (
          <BlockSkeleton rows={4} />
        ) : (
          <>
            <MoneyRow
              label="К выплате"
              hint="Сумма по сотрудникам с положительным балансом"
              amount={totalToAccrue}
            />

            {/* Удержания показываем ВСЕГДА, когда они есть.
                Раньше в сводке была только строка «Долги сотрудников» — она видна
                лишь тогда, когда штраф съел всю зарплату и баланс ушёл в минус.
                А обычный штраф (170 ₽ при заработке 32 000 ₽) баланс в минус не
                уводит: он молча вычитался внутри строки «К выплате», и админ
                считал, что удержание не прошло. */}
            {totalPenalties < 0 && (
              <div className="min-w-0 overflow-hidden rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <MoneyRow
                  label="Списано с сотрудников"
                  hint="Ещё не выплачено · уже вычтено из «К выплате»"
                  amount={totalPenalties}
                  amountClass="text-destructive"
                />
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {penaltiesCount} шт. у {penaltiesUsers} {personWord(penaltiesUsers)}
                </p>

                {/* Штрафы и удержания разделены: по одной сумме нельзя понять,
                    это нарушения в цехе или люди рассчитались за спецодежду. */}
                {totalDeductions < 0 && (
                  <div className="mt-2 space-y-2 border-t border-destructive/20 pt-2 text-xs">
                    {fines < 0 && (
                      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                        <span className="flex min-w-0 items-start gap-1.5 break-words text-muted-foreground">
                          <Icon
                            name="TriangleAlert"
                            size={12}
                            className="mt-0.5 shrink-0 text-destructive"
                          />
                          <span className="min-w-0">Штрафы · {finesCount} шт.</span>
                        </span>
                        <span className="shrink-0 pl-5 font-semibold tabular-nums text-destructive sm:pl-0">
                          {formatMoney(fines)} ₽
                        </span>
                      </div>
                    )}
                    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                      <span className="flex min-w-0 items-start gap-1.5 break-words text-muted-foreground">
                        <Icon name="Wallet" size={12} className="mt-0.5 shrink-0" />
                        <span className="min-w-0">
                          Удержания без вины · {deductionsCount} шт.
                        </span>
                      </span>
                      <span className="shrink-0 pl-5 font-semibold tabular-nums sm:pl-0">
                        {formatMoney(totalDeductions)} ₽
                      </span>
                    </div>
                  </div>
                )}

                {onShowPenalties && (
                  <button
                    type="button"
                    onClick={onShowPenalties}
                    className="mt-2 break-words text-left text-xs font-medium text-destructive underline underline-offset-2"
                  >
                    Показать все списания
                  </button>
                )}
              </div>
            )}

            {totalDebts < 0 && (
              <MoneyRow
                label="Долги сотрудников"
                hint="Штрафы превысили начисления"
                amount={totalDebts}
                amountClass="text-destructive"
              />
            )}

            <div className="min-w-0 space-y-2 border-t border-border pt-3">
              <p className="font-medium">Выплата 10 числа</p>
              <p className="break-words text-xs leading-snug text-muted-foreground">
                Невыплаченные начисления с 20-го по конец месяца
              </p>
              <p className="break-all font-semibold tabular-nums">
                {formatMoney(period1Total)} ₽
              </p>
            </div>
            <div className="min-w-0 space-y-2 border-t border-border pt-3">
              <p className="font-medium">Выплата 25 числа</p>
              <p className="break-words text-xs leading-snug text-muted-foreground">
                Невыплаченные начисления с 1-го по 19-е число
              </p>
              <p className="break-all font-semibold tabular-nums">
                {formatMoney(period2Total)} ₽
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default FinanceSummaryCard;
