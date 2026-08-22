import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface FbsChecklistHeaderProps {
  supply: SupplyDetail;
  /** Сколько вещей уже отсканировано в поставку. */
  scannedCount: number;
  /** Всего строк в списке: собранные плюс ожидающие. */
  total: number;
  /** Вещи, которые ещё не отсканированы. */
  awaitingCount: number;
  printing: boolean;
  onPrintMissing: () => void;
}

/**
 * Шапка чек-листа: предупреждение по уехавшей поставке, счётчик «собрано N из M»
 * и печать листа недостачи.
 */
const FbsChecklistHeader = ({
  supply,
  scannedCount,
  total,
  awaitingCount,
  printing,
  onPrintMissing,
}: FbsChecklistHeaderProps) => (
  <>
    {/* Поставка уже уехала, а несколько вещей так и не отсканировали в короб.
        Это НЕ потеря и не ошибка: вещи лежат на складе с наклеенными ярлыками и
        ждут следующей поставки. Раньше строка «не отсканировано: 4» висела без
        пояснения, и кладовщик шёл искать вещи, которые никуда не пропадали —
        добавить их в уехавшую поставку всё равно уже нельзя. */}
    {awaitingCount > 0 &&
      supply.status !== 'Открытая' &&
      supply.status !== 'На сборке' && (
      <div className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
        <div>
          Эти {awaitingCount} шт. не успели отсканировать до отгрузки. Вещи на месте,
          со стикерами — они ждут в подборе и уедут следующей поставкой. Досканировать
          их в эту поставку уже нельзя.
        </div>
      </div>
    )}

    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <h3 className="text-sm font-semibold">
        Собрано {scannedCount} из {total}
        {awaitingCount > 0 && (
          <span className="ml-2 font-normal text-muted-foreground">
            · не отсканировано: {awaitingCount}
          </span>
        )}
      </h3>
      {/* Лист недостачи печатают перед закрытием поставки: по нему ищут вещи,
          которые не доехали до короба. В нём заказ, размер, полка и фамилии —
          кто кроил, шил, упаковывал и когда. */}
      {awaitingCount > 0 && (
        <Button variant="outline" size="sm" onClick={onPrintMissing} disabled={printing}>
          <Icon
            name={printing ? 'Loader2' : 'Printer'}
            size={14}
            className={`mr-1.5 ${printing ? 'animate-spin' : ''}`}
          />
          Печать недостачи ({awaitingCount})
        </Button>
      )}
    </div>
  </>
);

export default FbsChecklistHeader;
