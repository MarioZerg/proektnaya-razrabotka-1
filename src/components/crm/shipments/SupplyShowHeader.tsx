import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { ShipmentDetail } from '@/lib/shipmentsApi';

/**
 * Шапка страницы приёмки: возврат к списку, заголовок с поставщиком и датой,
 * кнопка печати всех найденных стикеров. Разметка 1:1 из SupplyShow.
 */
interface Props {
  id?: string;
  detail: ShipmentDetail | null;
  loading: boolean;
  filteredCount: number;
  onBack: () => void;
  onPrintAllFound: () => void;
}

export const SupplyShowHeader = ({
  id,
  detail,
  loading,
  filteredCount,
  onBack,
  onPrintAllFound,
}: Props) => (
  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <Button variant="ghost" size="sm" className="mb-1 px-0" onClick={onBack}>
        <Icon name="ChevronLeft" size={16} className="mr-1" />
        К приёмкам
      </Button>
      <h1 className="text-xl font-bold">Приёмка #{id}</h1>
      {detail && (
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {detail.itemSuppliers || detail.supplierName || 'Поставщик не указан'} ·{' '}
          {formatDateTime(detail.completedAt || detail.createdAt)}
          {detail.comment ? ` · ${detail.comment}` : ''}
        </p>
      )}
    </div>
    <Button
      variant="outline"
      className="w-full shrink-0 sm:w-auto"
      onClick={onPrintAllFound}
      disabled={loading}
    >
      <Icon name="Barcode" size={16} className="mr-1" />
      Печать всех ({filteredCount})
    </Button>
  </div>
);

/**
 * Поиск рулона по штрихкоду и материалу: на 284 позициях глазами не найти,
 * а кладовщик приходит с конкретным рулоном в руках.
 */
interface SearchProps {
  search: string;
  setSearch: (v: string) => void;
}

export const SupplyShowSearch = ({ search, setSearch }: SearchProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="relative min-w-0 flex-1">
      <Icon
        name="Search"
        size={15}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className="pl-8"
        placeholder="Штрихкод или материал — можно сканером"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
    {search && (
      <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
        Сбросить
      </Button>
    )}
  </div>
);

export default SupplyShowHeader;
