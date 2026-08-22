import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  addExtraExpense,
  updateExtraExpense,
  deleteExtraExpense,
  type ExtraExpense,
  type SoldUnits,
} from '@/lib/productCostApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ExtraExpensesPanelProps {
  expenses: ExtraExpense[];
  /** Сколько вещей реально продано — подсказка для делителя. */
  sold?: SoldUnits;
  onChanged: () => void;
}

/**
 * Дополнительные расходы на единицу товара.
 *
 * Кроме ткани и сдельной работы цеха есть траты, которые к конкретной вещи не
 * привяжешь, но которые в ней всё равно сидят: коробка для отправки, оклады
 * кладовщика, менеджера, уборщицы. Владелец сам решает, что и на сколько штук
 * делить — система такие числа вывести не может.
 *
 * Пример: коробка 250 ₽ на 30 отправлений даёт 8,33 ₽ на вещь; оклад кладовщика
 * 60 000 ₽ при плане 4000 штук в месяц — 15 ₽ на вещь.
 *
 * Строку можно выключить, не удаляя: сезонные траты удобнее гасить, чем заводить
 * заново каждый раз.
 */
const ExtraExpensesPanel = ({ expenses, sold, onChanged }: ExtraExpensesPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [perItems, setPerItems] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const totalPerUnit = expenses
    .filter((e) => e.isActive)
    .reduce((s, e) => s + e.perUnit, 0);

  const fail = (e: unknown, title: string) =>
    toast({
      title,
      description: e instanceof Error ? e.message : undefined,
      variant: 'destructive',
    });

  const handleAdd = async () => {
    if (!name.trim()) {
      toast({ title: 'Укажите название расхода', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await addExtraExpense({
        name: name.trim(),
        amount: Number(amount) || 0,
        perItems: Number(perItems) || 1,
        note: note.trim(),
        actorId: user?.id,
      });
      setName('');
      setAmount('');
      setPerItems('');
      setNote('');
      onChanged();
    } catch (e) {
      fail(e, 'Не удалось добавить');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (x: ExtraExpense) => {
    try {
      await updateExtraExpense({
        id: x.id,
        name: x.name,
        amount: x.amount,
        perItems: x.perItems,
        note: x.note,
        isActive: !x.isActive,
        actorId: user?.id,
      });
      onChanged();
    } catch (e) {
      fail(e, 'Не удалось изменить');
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteExtraExpense(id, user?.id);
      onChanged();
    } catch (e) {
      fail(e, 'Не удалось удалить');
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Дополнительные расходы
          {totalPerUnit > 0 && (
            <Badge variant="secondary">+{money(totalPerUnit)} ₽ на каждую вещь</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Что не привязано к конкретной вещи, но входит в её стоимость: коробка, оклады
          кладовщика, менеджера, уборщицы. Укажите сумму и на сколько штук её делить.
        </p>

        {/* Факт продаж под рукой: оклады раньше делили на прикидку «примерно
            4000 в месяц», а ошибка в делителе бьёт по всей себестоимости.
            Оклад 60 000 ₽ на 4000 штук — это 15 ₽ на вещь, на 1460 — уже 41 ₽. */}
        {sold && sold.total > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon name="PackageCheck" size={14} />
                  Продано за {sold.days} дней:{' '}
                  <span className="text-lg font-bold">{sold.total}</span> шт
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Только то, за что деньги получены — со своего склада и со
                  склада площадки, за вычетом возвратов
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPerItems(String(sold.total))}
              >
                <Icon name="ArrowDownToLine" size={14} className="mr-1.5" />
                Подставить в делитель
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {sold.byMarketplace.map((m) => (
                <span key={m.marketplace}>
                  {m.marketplace}: <b className="text-foreground">{m.net}</b> шт
                  {/* Разбивку показываем там, где есть обе схемы: FBO — это
                      больше половины продаж, и его легко не заметить. */}
                  {m.fbo > 0 && ` (FBO ${m.fbo} + FBS ${m.fbs})`}
                </span>
              ))}
            </div>
            {/* По WB и Яндексу выгрузки продаж нет — считаем по отгрузкам.
                Часть могут не выкупить, поэтому цифра чуть оптимистичнее. */}
            {sold.byMarketplace.some((m) => m.source === 'orders') && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                OZON — по данным площадки, обе схемы.{' '}
                {sold.byMarketplace
                  .filter((m) => m.source === 'orders')
                  .map((m) => m.marketplace)
                  .join(', ')}{' '}
                — по нашим отгрузкам: выгрузки продаж у них нет
              </p>
            )}
          </div>
        )}

        {expenses.length > 0 && (
          <div className="space-y-1.5">
            {expenses.map((x) => (
              <div
                key={x.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 ${
                  x.isActive ? 'border-border' : 'border-dashed border-border opacity-60'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{x.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {money(x.amount)} ₽ ÷ {x.perItems} шт
                    {x.note ? ` · ${x.note}` : ''}
                  </p>
                  {/* Делитель сильно выше факта — расход недооценён.
                      Молчать об этом нельзя: себестоимость выглядит ниже
                      настоящей, а решения по ценам принимаются по ней. */}
                  {sold && sold.total > 0 && x.isActive
                    && x.perItems > sold.total * 1.3 && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
                      <Icon name="TriangleAlert" size={11} className="shrink-0" />
                      делите на {x.perItems}, а продано {sold.total} — по факту
                      это {money(x.amount / sold.total)} ₽ на вещь
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold">{money(x.perUnit)} ₽</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggle(x)}
                    title={x.isActive ? 'Выключить из расчёта' : 'Включить в расчёт'}
                  >
                    <Icon name={x.isActive ? 'Eye' : 'EyeOff'} size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(x.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Удалить"
                  >
                    <Icon name="X" size={14} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Название</Label>
            <Input
              placeholder="Коробка для отправки"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Сумма, ₽</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              placeholder="250"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Делим на, шт</Label>
            <Input
              type="number"
              min={1}
              placeholder="30"
              value={perItems}
              onChange={(e) => setPerItems(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Пояснение (необязательно)</Label>
          <Input
            placeholder="Оклад 60 000 при плане 4000 штук в месяц"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <Button variant="outline" onClick={handleAdd} disabled={saving}>
          <Icon
            name={saving ? 'Loader2' : 'Plus'}
            size={16}
            className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
          />
          Добавить расход
        </Button>
      </CardContent>
    </Card>
  );
};

export default ExtraExpensesPanel;