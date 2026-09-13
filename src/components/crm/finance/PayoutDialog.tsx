import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  previewPayout,
  type PayoutPreview,
  type PendingPayout,
} from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';
import PayoutEmployeePeriod from '@/components/crm/finance/payout/PayoutEmployeePeriod';
import PayoutSbpCard from '@/components/crm/finance/payout/PayoutSbpCard';
import PayoutDebtsCard from '@/components/crm/finance/payout/PayoutDebtsCard';
import PayoutAmountPanel from '@/components/crm/finance/payout/PayoutAmountPanel';

interface PayoutDialogProps {
  /** Только те, у кого есть невыплаченный остаток — с суммой. */
  pending: PendingPayout[];
  saving: boolean;
  onSubmit: (
    userId: number,
    periodFrom?: string,
    periodTo?: string,
    debtIds?: number[],
    /** Выплатить меньше начисленного — остаток уедет на следующий расчёт. */
    amount?: number,
  ) => Promise<void>;
}

const PayoutDialog = ({ pending, saving, onSubmit }: PayoutDialogProps) => {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * Почему сумма не посчиталась.
   *
   * Раньше ошибка запроса глушилась молча: сессия истекла, связь моргнула,
   * админ смотрел панель глазами сотрудника — а на экране просто «0 ₽».
   * Выглядело так, будто человеку нечего платить, хотя начисления есть.
   */
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  /** Отмеченные старые долги — их удержим из этой выплаты. */
  const [debtIds, setDebtIds] = useState<number[]>([]);
  /**
   * Сумма к выдаче, если платим НЕ всю начисленную.
   *
   * Пусто — платим период целиком, как раньше. Введено меньшее число —
   * выдаём его, а разница остаётся невыплаченной и сама попадёт
   * в следующий расчёт.
   */
  const [payAmount, setPayAmount] = useState('');

  // Сумма пересчитывается при смене сотрудника или дат: админ должен видеть,
  // сколько уйдёт из кассы, ДО нажатия кнопки, а не узнавать постфактум.
  useEffect(() => {
    if (!userId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    // Сумма частичной выплаты привязана к конкретному человеку и периоду.
    // Сменили любое из них — прежнее число уже не к месту.
    setPayAmount('');
    previewPayout(Number(userId), from || undefined, to || undefined)
      .then((d) => {
        if (cancelled) return;
        setPreview(d);
        // Долги по умолчанию отмечены: копить их незачем, а снять галочку
        // проще, чем вспомнить о забытом штрафе.
        setDebtIds((d.outsideDebts || []).map((x) => x.id));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview(null);
        // Показываем причину вместо нуля: «0 ₽» и «не смог посчитать» —
        // разные вещи, и по первому админ решает, что платить нечего.
        setError(
          e instanceof Error ? e.message : 'Не удалось посчитать сумму',
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId, from, to]);

  const handleSubmit = async () => {
    if (!userId) return;
    // Сумму передаём, только если её задали руками: иначе сервер платит
    // период целиком, как было до появления частичной выплаты.
    const typed = payAmount.trim() ? Number(payAmount.replace(',', '.')) : undefined;
    await onSubmit(
      Number(userId),
      from || undefined,
      to || undefined,
      debtIds,
      typed && Number.isFinite(typed) ? typed : undefined,
    );

    // ОКНО НЕ ЗАКРЫВАЕМ.
    //
    // Зарплату платят пачкой: десять человек подряд, один за другим. Раньше
    // после каждой выплаты окно захлопывалось, и приходилось заново открывать
    // его, заново выставлять период — десять раз. Оставляем окно и период,
    // сбрасываем только выбранного сотрудника: он уже получил деньги и из
    // списка пропадёт, а следующего выбирают тут же.
    setUserId('');
    setPreview(null);
    // Сумму сбрасываем обязательно: следующему сотруднику она не подходит,
    // а забытое число молча урезало бы ему выплату.
    setPayAmount('');
  };

  const debts = preview?.outsideDebts || [];
  const accrued = preview?.amount || 0;

  // Сколько удержим отмеченными галочками долгами. Долг не может увести
  // выплату в минус: гасим ровно столько, сколько покрывает заработок,
  // остаток перейдёт на следующую выплату — так же считает и сервер.
  const debtSum = debts
    .filter((d) => debtIds.includes(d.id))
    .reduce((s, d) => s + Math.abs(d.amount), 0);
  const willRepay = Math.min(debtSum, Math.max(accrued, 0));
  const carryOver = debtSum - willRepay;

  /** Сколько выйдет к выдаче, если платить период целиком. */
  const fullAmount = Math.max(accrued - willRepay, 0);

  // ЧАСТИЧНАЯ ВЫПЛАТА.
  //
  // Поле пустое — платим всё, как раньше. Ввели меньшую сумму — выдаём её,
  // а разницу сервер оставит невыплаченной, и она сама попадёт в следующий
  // расчёт. Больше начисленного ввести нельзя: это уже аванс, для него есть
  // отдельное ручное начисление.
  const typedAmount = payAmount.trim()
    ? Number(payAmount.replace(',', '.'))
    : null;
  const amountValid =
    typedAmount === null ||
    (Number.isFinite(typedAmount) && typedAmount > 0 && typedAmount <= fullAmount + 0.009);
  const amount =
    typedAmount !== null && amountValid ? typedAmount : fullAmount;
  /** Что уедет на следующий период из-за недоплаты. */
  const restToNextPeriod =
    typedAmount !== null && amountValid ? Math.max(fullAmount - typedAmount, 0) : 0;

  const notEnough = !!preview && preview.cashBalance < amount;
  const wholePeriod = !from && !to;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">
          <Icon name="Banknote" size={16} className="mr-2" />
          Выплатить зарплату
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Выплатить зарплату</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <PayoutEmployeePeriod
            pending={pending}
            userId={userId}
            setUserId={setUserId}
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            wholePeriod={wholePeriod}
          />

          {userId && !loading && preview && (
            <PayoutSbpCard
              preview={preview}
              copied={copied}
              setCopied={setCopied}
            />
          )}

          {userId && !loading && debts.length > 0 && (
            <PayoutDebtsCard
              debts={debts}
              debtIds={debtIds}
              setDebtIds={setDebtIds}
              willRepay={willRepay}
              carryOver={carryOver}
            />
          )}

          {userId && (
            <PayoutAmountPanel
              loading={loading}
              error={error}
              preview={preview}
              wholePeriod={wholePeriod}
              fullAmount={fullAmount}
              payAmount={payAmount}
              setPayAmount={setPayAmount}
              amountValid={amountValid}
              restToNextPeriod={restToNextPeriod}
              accrued={accrued}
              willRepay={willRepay}
              notEnough={notEnough}
            />
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={saving || !userId || amount <= 0 || notEnough || !amountValid}
          >
            {saving
              ? 'Выплата...'
              : `Выплатить ${amount > 0 ? `${formatMoney(amount)} ₽` : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PayoutDialog;
