import { Dispatch, SetStateAction } from 'react';
import type { Order } from '@/lib/ordersApi';
import SewingItemsTable from '@/components/crm/sewingItems/SewingItemsTable';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface SewingItemsResultsProps {
  loading: boolean;
  listError: string | null;
  load: () => void;
  totalMeters: number;
  totalPieces: number;
  pagedOrders: Order[];
  onOpenDetail: (order: Order) => void;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  totalCount: number;
  canPrintSticker: boolean;
  /** Сколько заказов вкладки спрятано выбранными фильтрами (тип, ткань, размер…). */
  hiddenByFilters?: number;
  onResetFilters?: () => void;
}

/** Итоги по странице, ошибка загрузки и сама таблица заказов. */
const SewingItemsResults = ({
  loading,
  listError,
  load,
  totalMeters,
  totalPieces,
  pagedOrders,
  onOpenDetail,
  page,
  setPage,
  totalPages,
  totalCount,
  canPrintSticker,
  hiddenByFilters = 0,
  onResetFilters,
}: SewingItemsResultsProps) => (
  <>
    {/* Фильтры прячут часть заказов вкладки — говорим об этом прямо. Без этой
        плашки заказ, отсечённый, например, фильтром «FBS» после перехода с плитки
        «Срочные FBS», выглядел пропавшим: счётчик вкладки его видит, список — нет. */}
    {!loading && !listError && hiddenByFilters > 0 && (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <Icon name="FilterX" size={16} />
        <span>Ещё {hiddenByFilters} шт. на этой вкладке скрыто фильтрами</span>
        {onResetFilters && (
          <Button size="sm" variant="outline" className="ml-auto h-7" onClick={onResetFilters}>
            Показать все
          </Button>
        )}
      </div>
    )}
    {!loading && !listError && (
      <p className="text-sm text-muted-foreground">
        Итого на странице: {totalMeters.toFixed(2)} п.м. ({totalPieces} шт.)
      </p>
    )}

    {listError && (
      <WarehouseFetchError
        title="Не удалось загрузить заказы"
        description={listError}
        onRetry={load}
      />
    )}

    <SewingItemsTable
      loading={loading}
      error={listError}
      pagedOrders={pagedOrders}
      onOpenDetail={onOpenDetail}
      page={page}
      setPage={setPage}
      totalPages={totalPages}
      totalCount={totalCount}
      canPrintSticker={canPrintSticker}
    />
  </>
);

export default SewingItemsResults;