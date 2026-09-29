import { Dispatch, SetStateAction } from 'react';
import type { Order } from '@/lib/ordersApi';
import SewingItemsTable from '@/components/crm/sewingItems/SewingItemsTable';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

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
}: SewingItemsResultsProps) => (
  <>
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