import Icon from '@/components/ui/icon';
import type { Supply } from '@/lib/marketplaceSuppliesApi';
import ToMarketplaceCards from '@/components/crm/marketplaceSupplies/ToMarketplaceCards';

interface ToMarketplaceTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «поставок пока нет». */
  error?: string | null;
  supplies: Supply[];
  onOpen: (id: number) => void;
}

/** Лента поставок: короткие строки, без широкой таблицы. */
const ToMarketplaceTable = ({ loading, error = null, supplies, onOpen }: ToMarketplaceTableProps) => {
  if (loading && supplies.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (supplies.length === 0) {
    if (error) return null;
    return <p className="text-sm text-muted-foreground">Поставок пока нет</p>;
  }

  return <ToMarketplaceCards supplies={supplies} onOpen={onOpen} />;
};

export default ToMarketplaceTable;
