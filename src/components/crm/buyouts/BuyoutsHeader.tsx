import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';

/**
 * Шапка страницы выкупов: сколько всего забрали и кнопка обновления.
 *
 * Данные обновляет планировщик раз в два часа. Кнопка — для случая «хочу
 * видеть вчерашние продажи прямо сейчас».
 */
interface Props {
  total: number;
  syncing: boolean;
  onSync: () => void;
}

const BuyoutsHeader = ({ total, syncing, onSync }: Props) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 className="text-xl font-bold">Выкупы</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Заказы, которые покупатели забрали: цена покупки и что осталось нам
        после всех расходов площадки
      </p>
    </div>
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="text-sm">
        {total.toLocaleString('ru-RU')} выкуплено
      </Badge>
      {/* Данные обновляет планировщик дважды в сутки. Кнопка — для
          случая «хочу видеть вчерашние продажи прямо сейчас». */}
      <Button variant="outline" size="sm" disabled={syncing} onClick={onSync}>
        <Icon
          name="RefreshCw"
          size={14}
          className={`mr-1 ${syncing ? 'animate-spin' : ''}`}
        />
        Обновить
      </Button>
    </div>
  </div>
);

export default BuyoutsHeader;
