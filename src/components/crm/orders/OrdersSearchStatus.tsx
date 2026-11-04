import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface OrdersSearchErrorProps {
  searchError: string | null;
  onRetry: () => void;
}

/** Ошибка поиска заказа с кнопкой повтора. */
export const OrdersSearchError = ({ searchError, onRetry }: OrdersSearchErrorProps) =>
  searchError ? (
    <WarehouseFetchError
      title="Не удалось найти заказ"
      description={searchError}
      onRetry={onRetry}
    />
  ) : null;

interface OrdersSearchStatusProps {
  searchActive: boolean;
  searchError: string | null;
  searching: boolean;
  foundCount: number;
}

/* Пока идёт поиск, говорим об этом словами: пустая таблица читается как
   «ничего не нашлось», и человек уходит, не дождавшись ответа. */
const OrdersSearchStatus = ({ searchActive, searchError, searching, foundCount }: OrdersSearchStatusProps) =>
  searchActive && !searchError ? (
    <p className="text-sm text-muted-foreground">
      {searching
        ? 'Ищем заказ по номеру...'
        : `Найдено заказов: ${foundCount}. Поиск идёт по всей базе — ` +
          'фильтры и вкладки статусов к нему не применяются.'}
    </p>
  ) : null;

export default OrdersSearchStatus;
