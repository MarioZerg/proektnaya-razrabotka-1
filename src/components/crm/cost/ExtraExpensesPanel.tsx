import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  addExtraExpense,
  updateExtraExpense,
  deleteExtraExpense,
  type ExtraExpense,
} from '@/lib/productCostApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ExtraExpensesPanelProps {
  expenses: ExtraExpense[];
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
const ExtraExpensesPanel = ({ expenses, onChanged }: ExtraExpensesPanelProps) => {
  const { toast } = useToast();
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
      });
      onChanged();
    } catch (e) {
      fail(e, 'Не удалось изменить');
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteExtraExpense(id);
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
