import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import {
  previewPayout,
  type PayoutPreview,
  type PendingPayout,
} from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

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

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Быстрые периоды: закрывают привычные отрезки в один клик. */
const quickPeriods = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const prevFrom = new Date(y, m - 1, 1);
  const prevTo = new Date(y, m, 0);
  return [
    {
      label: 'Первая половина',
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m, 15)),
    },
    {
      label: 'Вторая половина',
      from: iso(new Date(y, m, 16)),
      to: iso(new Date(y, m, lastDay)),
    },
    {
      label: 'Текущий месяц',
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m, lastDay)),
    },
    { label: 'Прошлый месяц', from: iso(prevFrom), to: iso(prevTo) },
  ];
};

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
          <div className="space-y-1.5">
            <Label>Сотрудник</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {/* В списке только те, кому правда есть что выплатить.
                    Раньше стояли все сотрудники компании, включая уволенных и
                    тех, у кого ничего не начислено: админ выбирал наугад и
                    получал отказ «нет начислений» уже после нажатия. */}
                {pending.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    Невыплаченных начислений нет
                  </div>
                ) : (
                  pending.map((e) => (
                    <SelectItem key={e.userId} value={String(e.userId)}>
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="truncate">{e.fullName}</span>
                        <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                          {formatMoney(e.amount)} ₽
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Период</Label>
            <div className="flex flex-wrap gap-1.5">
              {quickPeriods().map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant={
                    from === p.from && to === p.to ? 'default' : 'outline'
                  }
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                  }}
                >
                  {p.label}
                </Button>
              ))}
              <Button
                type="button"
                variant={wholePeriod ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                Всё целиком
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* КУДА ПЕРЕВОДИТЬ.
              Деньги уходят по СБП, а номер лежал только в профиле: чтобы
              перевести, приходилось открывать вторую вкладку и переписывать
              телефон руками. Показываем его прямо здесь, рядом с суммой. */}
          {userId && !loading && preview && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              {preview.sbpPhone ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Перевод по СБП
                      </p>
                      <p className="truncate text-base font-bold tracking-tight">
                        {preview.sbpPhone}
                      </p>
                      {!!preview.sbpBank && (
                        <p className="truncate text-xs text-muted-foreground">
                          {preview.sbpBank}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={() => {
                        navigator.clipboard?.writeText(preview.sbpPhone || '');
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      <Icon
                        name={copied ? 'Check' : 'Copy'}
                        size={13}
                        className="mr-1"
                      />
                      {copied ? 'Скопировано' : 'Копировать'}
                    </Button>
                  </div>

                  {/* Неподтверждённые реквизиты — не запрет, а повод сверить:
                      деньги уйдут по этому номеру безвозвратно. */}
                  {!preview.sbpConfirmed && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                      <Icon
                        name="TriangleAlert"
                        size={12}
                        className="mt-0.5 shrink-0"
                      />
                      Реквизиты ещё не сверены администратором — проверьте номер
                      перед переводом
                    </p>
                  )}
                </>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Icon
                    name="Info"
                    size={13}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  Сотрудник не указал номер СБП в профиле.
                  {preview.loginPhone
                    ? ` Телефон для входа: ${preview.loginPhone}`
                    : ''}
                </p>
              )}
            </div>
          )}

          {/* СТАРЫЕ ДОЛГИ ВНЕ ВЫБРАННОГО ПЕРИОДА.
              Штраф выписан 21-го, а закрывают первую половину месяца — он не
              попадал в выплату и висел вечно, копясь в виджете кассы. Теперь
              он виден здесь, и его можно удержать галочкой. */}
          {userId && !loading && debts.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <Icon name="TriangleAlert" size={13} className="shrink-0" />
                Непогашенные удержания за другие даты
              </p>
              <div className="mt-2 space-y-1.5">
                {debts.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-start gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-600"
                      checked={debtIds.includes(d.id)}
                      onChange={(e) =>
                        setDebtIds((prev) =>
                          e.target.checked
                            ? [...prev, d.id]
                            : prev.filter((x) => x !== d.id),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-amber-900">
                        {formatMoney(Math.abs(d.amount))} ₽
                      </span>
                      <span className="text-amber-800">
                        {' '}
                        · {d.type === 'penalty' ? 'штраф' : 'удержание'} от{' '}
                        {d.accruedFor}
                      </span>
                      <span className="block truncate text-amber-700">
                        {d.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {/* Долг больше заработка — гасим частично, остальное перенесём.
                  Человек не должен уйти с выплатой «минус». */}
              {carryOver > 0 && (
                <p className="mt-2 text-xs text-amber-800">
                  Заработка хватает на {formatMoney(willRepay)} ₽ — остаток{' '}
                  {formatMoney(carryOver)} ₽ перейдёт на следующую выплату
                </p>
              )}
            </div>
          )}

          {userId && (
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
                  <Icon
                    name="TriangleAlert"
                    size={14}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    Не удалось посчитать сумму: {error}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Обновите страницу или войдите заново — начисления никуда
                      не делись
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
                        Выплатить сейчас (можно меньше — остаток перейдёт
                        в следующий период)
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
                          {formatMoney(fullAmount)} ₽. Чтобы выдать сверх
                          заработанного, оформите аванс отдельным начислением
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
                            <b>{formatMoney(restToNextPeriod)} ₽</b> — сумма
                            останется за сотрудником и сама войдёт в ближайшую
                            выплату
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
                  {notEnough && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                      <Icon
                        name="TriangleAlert"
                        size={12}
                        className="mt-0.5 shrink-0"
                      />
                      В кассе только {formatMoney(preview.cashBalance)} ₽ —
                      пополните кассу перед выплатой
                    </p>
                  )}
                </>
              )}
            </div>
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