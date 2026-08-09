import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Roll } from '@/lib/rollsApi';

interface RollsCardsProps {
  rolls: Roll[];
  statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }>;
  formatQuantity: (n: number) => string;
  formatDate: (d: string) => string;
  shiftLabel: (roll: Roll) => string;
  onOpen: (id: number) => void;
}

/** Мобильный вид списка рулонов — карточки вместо таблицы на 10 колонок,
 * чтобы закройщик на телефоне не листал экран вбок. */
const RollsCards = ({
  rolls,
  statusLabels,
  formatQuantity,
  formatDate,
  shiftLabel,
  onOpen,
}: RollsCardsProps) => {
  return (
    <div className="space-y-3">
      {rolls.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r.id)}
          className="w-full rounded-md border border-border p-3 text-left active:bg-accent"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold">{r.materialName || '—'}</div>
              <div className="font-mono-tech text-xs text-muted-foreground">{r.barcode}</div>
            </div>
            <Badge variant={(statusLabels[r.status] || { variant: 'outline' as const }).variant}>
              {(statusLabels[r.status] || { label: r.status }).label}
            </Badge>
          </div>

          <div className="mt-2 text-sm">
            Остаток:{' '}
            <span className="font-medium">
              {formatQuantity(r.remainingQuantity)} из {formatQuantity(r.initialQuantity)} {r.unit}
            </span>
          </div>

          {r.shortageQuantity && r.shortageQuantity > 0 ? (
            <Badge variant="destructive" className="mt-2 font-normal">
              Недостача {formatQuantity(r.shortageQuantity)} {r.unit}
            </Badge>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {r.workshopName && (
              <span className="flex items-center gap-1">
                <Icon name="Factory" size={12} />
                {r.workshopName}
              </span>
            )}
            <span>{shiftLabel(r)}</span>
            <span>#{r.id}</span>
          </div>

          <div className="mt-1 text-xs text-muted-foreground">
            Создан {formatDate(r.createdAt)}
            {r.completedAt ? ` · завершён ${formatDate(r.completedAt)}` : ''}
          </div>
        </button>
      ))}
    </div>
  );
};

export default RollsCards;
