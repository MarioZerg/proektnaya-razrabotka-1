import { CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyBox } from '@/lib/marketplaceSuppliesApi';

interface SupplyBoxCardHeaderProps {
  box: SupplyBox;
  isOzonFbo: boolean;
  open: boolean;
  canScan: boolean;
}

/**
 * Свёрнутая плашка короба: номер, количество, статусы, штрихкод.
 *
 * Именно её кладовщик видит, не раскрывая короб, — по количеству понимает,
 * куда класть следующую вещь, а по значкам справа, ушёл ли короб на площадку.
 */
const SupplyBoxCardHeader = ({
  box,
  isOzonFbo,
  open,
  canScan,
}: SupplyBoxCardHeaderProps) => (
  <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
    <Icon
      name="ChevronRight"
      size={16}
      className={`shrink-0 text-muted-foreground transition-transform ${
        open ? 'rotate-90' : ''
      }`}
    />
    <Icon
      name={box.closedAt ? 'PackageCheck' : 'Package'}
      size={18}
      className={`shrink-0 ${box.closedAt ? 'text-emerald-600' : 'text-muted-foreground'}`}
    />

    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Короб №{box.boxNumber}</span>
        {/* Количество вещей — главное число плашки: по нему кладовщик
            понимает, куда класть следующую, не раскрывая короб. */}
        <Badge variant={box.items.length ? 'default' : 'outline'}>
          {box.items.length} шт.
        </Badge>
        {box.closedAt && (
          <Badge variant="secondary" className="text-[10px]">Закрыт</Badge>
        )}
        {/* ГРУЗОМЕСТО НА ПЛОЩАДКЕ — ГЛАВНЫЙ ПРИЗНАК, ЧТО КОРОБ РЕАЛЬНО УЕХАЛ.
            Закрытый короб без cargo_id означает, что на OZON его нет: заявка
            придёт без этого грузоместа, и на приёмке короб окажется лишним.
            Раньше оба состояния выглядели одинаково — просто «Закрыт». */}
        {isOzonFbo && box.closedAt && (
          box.ozonCargoId ? (
            <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
              На OZON #{box.ozonCargoId}
            </Badge>
          ) : (
            <Badge className="bg-amber-600 text-[10px] text-white hover:bg-amber-600">
              Не ушёл на OZON
            </Badge>
          )
        )}
      </div>
      <p className="truncate font-mono-tech text-xs text-muted-foreground">
        {box.barcode}
      </p>
    </div>

    {/* Подсказка на свёрнутой плашке: куда жать, чтобы начать набивать. */}
    {!open && canScan && (
      <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
        <Icon name="ScanLine" size={13} />
        Открыть и сканировать
      </span>
    )}
  </CollapsibleTrigger>
);

export default SupplyBoxCardHeader;
