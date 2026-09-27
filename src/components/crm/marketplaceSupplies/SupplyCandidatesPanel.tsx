import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyCandidate } from '@/lib/marketplaceSuppliesApi';
import { candidateStatusVariant } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface SupplyCandidatesPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: SupplyCandidate[];
  loading: boolean;
  listError?: string | null;
  onRetry?: () => void;
}

const SupplyCandidatesPanel = ({
  open,
  onOpenChange,
  candidates,
  loading,
  listError,
  onRetry,
}: SupplyCandidatesPanelProps) => {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between">
          <span className="flex items-center gap-1.5">
            <Icon name="ListChecks" size={14} />
            Товары, которые должны быть в этой поставке ({candidates.length})
          </span>
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <div className="max-h-96 overflow-y-auto rounded-md border border-border">
          {loading && candidates.length === 0 ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Загрузка...
            </div>
          ) : listError && candidates.length === 0 ? (
            <div className="p-3">
              <WarehouseFetchError
                title="Не удалось загрузить товары поставки"
                description={listError}
                onRetry={onRetry || (() => {})}
              />
            </div>
          ) : candidates.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Нет заказов этого маркетплейса с тем же кластером
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-2 text-left font-medium">Номер заказа</th>
                  <th className="p-2 text-left font-medium">Товар</th>
                  <th className="p-2 text-left font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.orderId} className="border-t border-border">
                    <td className="p-2 font-mono-tech">{c.orderNumber}</td>
                    <td className="p-2">{c.product || '—'}</td>
                    <td className="p-2">
                      <Badge variant={candidateStatusVariant(c.status)}>{c.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SupplyCandidatesPanel;
