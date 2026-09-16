import { Badge } from '@/components/ui/badge';
import type { DefectHistoryRow } from '@/lib/kioskApi';
import { roleLabels, formatQty, formatDate } from './defectShared';

interface DefectReceivedCardsProps {
  rows: DefectHistoryRow[];
}

/** Мобильный вид принятого брака. Семь колонок таблицы на телефоне уезжали
 *  вбок — рулон, поставку и кто принял приходилось искать прокруткой. */
const DefectReceivedCards = ({ rows }: DefectReceivedCardsProps) => (
  <div className="space-y-3">
    {rows.map((r) => (
      <div
        key={r.barcode}
        className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="break-words font-semibold">{r.materialName}</div>
            <div className="text-xs text-muted-foreground">{r.barcode}</div>
          </div>
          <div className="shrink-0 text-right font-semibold tabular-nums">
            {formatQty(r.quantity)} {r.unit || ''}
          </div>
        </div>

        <div className="mt-2 space-y-1 text-sm">
          <div className="min-w-0 break-words">
            <span className="text-muted-foreground">Сотрудник: </span>
            {r.userName}
            {r.userRole && (
              <span className="text-muted-foreground">
                {' '}
                ({roleLabels[r.userRole] || r.userRole})
              </span>
            )}
          </div>
          <div className="min-w-0 break-words">
            <span className="text-muted-foreground">Рулон: </span>
            <span className="font-mono-tech">{r.rollBarcode || '—'}</span>
          </div>
          <div className="min-w-0 break-words">
            <span className="text-muted-foreground">Поставка: </span>
            {r.supplierName || '—'}
            {r.shipmentId && (
              <span className="text-muted-foreground">
                {' '}
                · №{r.shipmentId}
                {r.shipmentDate ? ` · ${formatDate(r.shipmentDate)}` : ''}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-muted-foreground">Причина: </span>
            <Badge variant="secondary">{r.reasonLabel}</Badge>
            {r.comment && (
              <div className="mt-1 break-words text-xs text-muted-foreground">{r.comment}</div>
            )}
          </div>
          <div className="min-w-0 break-words">
            <span className="text-muted-foreground">Принят: </span>
            {formatDate(r.receivedAt)}
            {r.receivedByName && (
              <span className="text-muted-foreground"> · {r.receivedByName}</span>
            )}
          </div>
        </div>
      </div>
    ))}
  </div>
);

export default DefectReceivedCards;
