import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Supply } from '@/lib/marketplaceSuppliesApi';
import SupplySewingProgress from '@/components/crm/marketplaceSupplies/SupplySewingProgress';
import { formatDate } from '@/lib/dateUtils';
import { marketplaceLogo, statusVariant } from './toMarketplaceConstants';

interface ToMarketplaceCardsProps {
  supplies: Supply[];
  onOpen: (id: number) => void;
}

/**
 * Мобильный вид списка поставок в маркет. Шесть колонок table-fixed на телефоне
 * сжимают заголовки в кашу и накладывают «Открытая» на Wildberries — карточку
 * пальцем попасть проще, чем в сплющенную строку.
 */
const ToMarketplaceCards = ({ supplies, onOpen }: ToMarketplaceCardsProps) => (
  <div className="space-y-3">
    {supplies.map((s) => (
      <button
        key={s.id}
        type="button"
        onClick={() => onOpen(s.id)}
        className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3 text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="break-words font-semibold leading-snug">
              {s.supplyNumber || `Поставка №${s.id}`}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              #{s.id}
              {s.type ? ` · ${s.type}` : ''}
              {s.gazelkaId ? ` · Газелька ${s.gazelkaId}` : ''}
            </div>
          </div>
          <Badge className={`shrink-0 ${statusVariant[s.status]?.className || ''}`}>
            {s.status}
          </Badge>
        </div>

        {s.lockedByName && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
            <Icon name="Lock" size={11} />
            Собирает: {s.lockedByName}
          </span>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className={marketplaceLogo[s.marketplace]?.className}>
            {marketplaceLogo[s.marketplace]?.label || s.marketplace}
          </span>
          {s.marketplace === 'WB' && s.type === 'FBS' ? (
            <Badge variant={s.itemsCount > 0 ? 'default' : 'outline'}>{s.itemsCount} шт.</Badge>
          ) : s.type === 'FBO' && s.plannedQuantity ? (
            <span
              className={
                s.itemsCount >= s.plannedQuantity
                  ? 'font-medium text-emerald-600'
                  : 'font-medium text-amber-600'
              }
            >
              {s.itemsCount} из {s.plannedQuantity} шт.
            </span>
          ) : (
            <span>{s.itemsCount} шт.</span>
          )}
        </div>

        {!!s.readyToScanCount && s.status !== 'Выполнена' && (
          <div className="mt-1 text-xs text-amber-700">ждёт сканирования: {s.readyToScanCount}</div>
        )}

        {(s.sewingTotal || 0) > 0 && (
          <div className="mt-2">
            <div className="mb-0.5 text-[11px] text-muted-foreground">Сшито</div>
            <SupplySewingProgress total={s.sewingTotal || 0} done={s.sewingDone || 0} compact />
          </div>
        )}

        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div>Создан: {formatDate(s.createdAt)}</div>
          {s.shipToGazelkaAt && <div>В Газельку: {formatDate(s.shipToGazelkaAt)}</div>}
          {s.shipToMarketplaceAt && <div>В маркет: {formatDate(s.shipToMarketplaceAt)}</div>}
          {s.completedAt && (
            <div className="font-medium text-emerald-600">Выполнен: {formatDate(s.completedAt)}</div>
          )}
        </div>
      </button>
    ))}
  </div>
);

export default ToMarketplaceCards;
