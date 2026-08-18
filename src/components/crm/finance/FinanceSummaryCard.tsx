import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface FinanceSummaryCardProps {
  totalToAccrue: number;
  totalDebts: number;
  /** Сумма ВСЕХ невыплаченных удержаний (отрицательная), независимо от заработка. */
  totalPenalties: number;
  penaltiesCount: number;
  penaltiesUsers: number;
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

const FinanceSummaryCard = ({
  totalToAccrue,
  totalDebts,
  totalPenalties,
  penaltiesCount,
  penaltiesUsers,
  period1Total,
  period2Total,
  loading,
  onShowPenalties,
}: FinanceSummaryCardProps) => {
  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Баланс начислений</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div>
              <p className="text-muted-foreground">К выплате (сумма начислений по сотрудникам с положительным балансом)</p>
              <p className="text-xl font-bold">{formatMoney(totalToAccrue)} ₽</p>
            </div>

            {/* Удержания показываем ВСЕГДА, когда они есть.
                Раньше в сводке была только строка «Долги сотрудников» — она видна
                лишь тогда, когда штраф съел всю зарплату и баланс ушёл в минус.
                А обычный штраф (170 ₽ при заработке 32 000 ₽) баланс в минус не
                уводит: он молча вычитался внутри строки «К выплате», и админ
                считал, что удержание не прошло. */}
            {totalPenalties < 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-muted-foreground">Удержания (штрафы, ещё не выплачено)</p>
                <p className="text-xl font-bold text-destructive">
                  {formatMoney(totalPenalties)} ₽
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {penaltiesCount} шт. у {penaltiesUsers} {personWord(penaltiesUsers)} · уже
                  вычтено из суммы к выплате
                </p>
                {onShowPenalties && (
                  <button
                    type="button"
                    onClick={onShowPenalties}
                    className="mt-1.5 text-xs font-medium text-destructive underline underline-offset-2"
                  >
                    Показать все штрафы
                  </button>
                )}
              </div>
            )}

            {totalDebts < 0 && (
              <div>
                <p className="text-muted-foreground">Долги сотрудников (штрафы превысили начисления)</p>
                <p className="text-xl font-bold text-destructive">{formatMoney(totalDebts)} ₽</p>
              </div>
            )}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="font-medium">Выплата 10 числа</p>
              <p className="text-xs text-muted-foreground">невыплаченные начисления за период с 20 по конец текущего месяца</p>
              <p className="font-semibold">{formatMoney(period1Total)} ₽</p>
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <p className="font-medium">Выплата 25 числа</p>
              <p className="text-xs text-muted-foreground">невыплаченные начисления за период с 1 по 19 число текущего месяца</p>
              <p className="font-semibold">{formatMoney(period2Total)} ₽</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default FinanceSummaryCard;
