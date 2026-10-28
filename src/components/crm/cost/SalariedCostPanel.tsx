import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { SalariedCost } from '@/lib/productCostApi';

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });

/** Оклады из «Финансов» за прошлый месяц, поделённые на изготовленные вещи. */
const SalariedCostPanel = ({ salaried }: { salaried: SalariedCost }) => {
  const [y, m] = salaried.month.split('-');
  const monthLabel = `${MONTHS[Number(m) - 1] || ''} ${y}`;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Icon name="Wallet" size={18} />
          Оклады из финансов
        </div>
        <p className="text-sm text-muted-foreground">
          Окладные начисления за {monthLabel} делятся на число вещей, сшитых за этот месяц, и входят в
          работу цеха каждой вещи. Считается само по данным «Финансов».
        </p>
        <div className="space-y-1 text-sm">
          {salaried.parts.map((p) => (
            <div key={p.type} className="flex justify-between">
              <span>{p.label}</span>
              <span>{money(p.amount)} ₽</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1 font-medium">
            <span>Итого оклады</span>
            <span>{money(salaried.total)} ₽</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Изготовлено за месяц</span>
            <span>{salaried.madeUnits.toLocaleString('ru-RU')} шт</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>На одну вещь</span>
            <span>{salaried.madeUnits ? `${money(salaried.perUnit)} ₽` : 'нет выпуска'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SalariedCostPanel;
