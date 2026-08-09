import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { ReturnPickupCode } from '@/lib/returnCodesApi';

/** Цвет плитки под фирменный цвет площадки — так кладовщик находит нужную не читая. */
const tileClass: Record<string, string> = {
  ozon: 'bg-blue-600 hover:bg-blue-700',
  wildberries: 'bg-purple-600 hover:bg-purple-700',
  yandex_market: 'bg-yellow-500 hover:bg-yellow-600',
};

const iconByMarketplace: Record<string, string> = {
  ozon: 'ShoppingBag',
  wildberries: 'ShoppingCart',
  yandex_market: 'Store',
};

interface ReturnCodeCardProps {
  item: ReturnPickupCode;
  isAdmin: boolean;
  refreshingId: string | null;
  onShow: (item: ReturnPickupCode) => void;
  onRefresh: (item: ReturnPickupCode) => void;
  onEdit: (item: ReturnPickupCode) => void;
}

/** Плитка маркетплейса: код, сколько ждёт к забору и кнопки обновления. */
const ReturnCodeCard = ({
  item,
  isAdmin,
  refreshingId,
  onShow,
  onRefresh,
  onEdit,
}: ReturnCodeCardProps) => (
  <Card className="border-border shadow-none">
    <CardContent className="space-y-3 pt-6">
      <button
        type="button"
        disabled={!item.code}
        onClick={() => onShow(item)}
        className={`flex h-28 w-full flex-col items-center justify-center gap-2 rounded-lg text-white ${
          item.code
            ? tileClass[item.marketplaceCode] || 'bg-primary hover:bg-primary/90'
            : 'cursor-not-allowed bg-muted text-muted-foreground'
        }`}
      >
        <Icon name={iconByMarketplace[item.marketplaceCode] || 'Package'} size={32} />
        <span className="text-lg font-bold">{item.title}</span>
      </button>

      {/* Сколько посылок ждёт именно на этой площадке. */}
      <p
        className={`text-center text-sm font-medium ${
          item.waitingCount > 0 ? 'text-amber-600' : 'text-muted-foreground'
        }`}
      >
        {item.waitingCount > 0
          ? `Ждёт к забору: ${item.waitingCount} шт.`
          : 'Нет возвратов к забору'}
      </p>

      {item.code ? (
        <>
          <p className="text-center font-mono-tech text-sm text-muted-foreground">
            {item.code}
          </p>
          {/* У OZON код меняется каждый день: вчерашний на ПВЗ не примут,
              поэтому прямо предупреждаем, что нужно обновить. */}
          {item.dailyRefresh && !item.updatedToday && (
            <p className="rounded bg-destructive/10 px-2 py-1 text-center text-sm font-medium text-destructive">
              Код устарел — обновите его сегодня
            </p>
          )}
        </>
      ) : (
        <p className="text-center text-sm text-amber-600">
          Код не заполнен — возврат не получить
        </p>
      )}

      {/* Обновление по API — только там, где код меняется ежедневно. */}
      {item.dailyRefresh && (
        <Button
          size="sm"
          className="w-full"
          onClick={() => onRefresh(item)}
          disabled={refreshingId === item.marketplaceCode}
        >
          <Icon
            name={refreshingId === item.marketplaceCode ? 'Loader2' : 'RefreshCw'}
            size={14}
            className={`mr-1 ${refreshingId === item.marketplaceCode ? 'animate-spin' : ''}`}
          />
          Обновить код
        </Button>
      )}

      {isAdmin && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onEdit(item)}
        >
          <Icon name="Pencil" size={14} className="mr-1" />
          {item.code ? 'Изменить код' : 'Задать код'}
        </Button>
      )}
    </CardContent>
  </Card>
);

export default ReturnCodeCard;
