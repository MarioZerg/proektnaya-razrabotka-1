import SupplyTypeBadge from './SupplyTypeBadge';
import B2bBadge from './B2bBadge';
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
 * Список поставок карточками — телефон и планшет / узкая колонка CRM.
 * Таблица с несколькими колонками здесь сжимает статусы и маркетплейсы в кашу.
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
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <SupplyTypeBadge type={s.type} />
              {s.isB2b && <B2bBadge />}
              <span className={marketplaceLogo[s.marketplace]?.className}>
                {marketplaceLogo[s.marketplace]?.label || s.marketplace}
              </span>
            </div>
            <div className="mt-1 break-words font-semibold leading-snug">
              {s.supplyNumber || `Поставка №${s.id}`}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              #{s.id}
              {/* Газелька возит только FBO — у FBS эта строка лишняя. */}
              {s.type !== 'FBS' && s.gazelkaId ? ` · Газелька ${s.gazelkaId}` : ''}
            </div>
          </div>
          <Badge className={`max-w-[40%] shrink-0 whitespace-normal text-center ${statusVariant[s.status]?.className || ''}`}>
            {s.status}
          </Badge>
        </div>

        {s.status === 'Отгрузка' && !!s.fbsMissingCount && (
          <span className="mt-2 mr-1 inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
            <Icon name="TriangleAlert" size={11} className="shrink-0" />
            Не отсканировано: {s.fbsMissingCount}
          </span>
        )}

        {s.lockedByName && (
          <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
            <Icon name="Lock" size={11} className="shrink-0" />
            <span className="min-w-0 break-words">Собирает: {s.lockedByName}</span>
          </span>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">Товары</div>
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
            {!!s.readyToScanCount && s.status !== 'Выполнена' && (
              <div className="mt-0.5 text-xs text-amber-700">
                ждёт скана: {s.readyToScanCount}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">Создан</div>
            <div className="text-muted-foreground">{formatDate(s.createdAt)}</div>
          </div>
        </div>

        {(s.sewingTotal || 0) > 0 && (
          <div className="mt-2">
            <div className="mb-0.5 text-[11px] text-muted-foreground">Сшито</div>
            <SupplySewingProgress total={s.sewingTotal || 0} done={s.sewingDone || 0} compact />
          </div>
        )}

        {(s.type !== 'FBS' && s.shipToGazelkaAt) || s.shipToMarketplaceAt || s.completedAt ? (
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {s.type !== 'FBS' && s.shipToGazelkaAt && (
              <div>В Газельку: {formatDate(s.shipToGazelkaAt)}</div>
            )}
            {s.shipToMarketplaceAt && <div>В маркет: {formatDate(s.shipToMarketplaceAt)}</div>}
            {s.completedAt && (
              <div className="font-medium text-emerald-600">
                Выполнен: {formatDate(s.completedAt)}
              </div>
            )}
          </div>
        ) : null}
      </button>
    ))}
  </div>
);

export default ToMarketplaceCards;
