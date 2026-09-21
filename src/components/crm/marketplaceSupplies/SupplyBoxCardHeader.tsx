import { CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SupplyBox } from '@/lib/marketplaceSuppliesApi';

interface SupplyBoxCardHeaderProps {
  box: SupplyBox;
  isOzonFbo: boolean;
  isWbFbo?: boolean;
  open: boolean;
  canScan: boolean;
  /** Идёт подготовка файла к печати — кнопка в плашке показывает это. */
  printing?: boolean;
  /** Печать стикера маркетплейса (OZON FBO) прямо из плашки. */
  onPrintSticker?: () => void;
  /** Печать стикера короба WB прямо из плашки. */
  onPrintWbSticker?: () => void;
  /** OZON ещё готовит этикетку — можно забрать её, не раскрывая короб. */
  fetchingLabel?: boolean;
  onFetchLabel?: () => void;
}

/**
 * Свёрнутая плашка короба: номер, количество, статусы, штрихкод.
 *
 * Именно её кладовщик видит, не раскрывая короб, — по количеству понимает,
 * куда класть следующую вещь, а по значкам справа, ушёл ли короб на площадку.
 *
 * ПЕЧАТЬ СТИКЕРА — ПРЯМО ОТСЮДА.
 *
 * Стикер печатают у стола с заклеенным коробом в руках, когда его состав уже
 * не трогают. Раньше до кнопки нужно было раскрыть короб и пролистать весь
 * список вещей вниз: на поставке в двадцать коробов — двадцать раскрытий и
 * двадцать прокруток. Теперь кнопка стоит в самой полосе короба.
 */
const SupplyBoxCardHeader = ({
  box,
  isOzonFbo,
  isWbFbo = false,
  open,
  canScan,
  printing = false,
  onPrintSticker,
  onPrintWbSticker,
  fetchingLabel = false,
  onFetchLabel,
}: SupplyBoxCardHeaderProps) => {
  // Что предлагаем нажать прямо в полосе короба:
  //   * есть стикер — печатаем его;
  //   * стикера нет, но грузоместо на OZON заведено — значит площадка ещё
  //     готовит файл, и его можно забрать, тоже не раскрывая короб;
  //   * закрытый короб WB — свой стикер, он рисуется у нас и есть всегда.
  const canPrintSticker = !!box.stickerUrl && !!onPrintSticker;
  const canFetchLabel =
    !box.stickerUrl && isOzonFbo && !!box.closedAt && !!box.ozonCargoId && !!onFetchLabel;
  // Стикер WB рисуется у нас и не требует файла с площадки: он есть у любого
  // закрытого короба. Показываем, только если своего стикера маркетплейса нет,
  // иначе в полосе оказались бы две кнопки печати подряд.
  const canPrintWb =
    isWbFbo && !!box.closedAt && !box.stickerUrl && !!onPrintWbSticker;

  return (
    /* Плашка — это одна широкая кнопка раскрытия, поэтому кнопку печати нельзя
       положить внутрь неё: вложенная кнопка и раскрывала бы короб заодно.
       Кладём их рядом в общей полосе, а триггер занимает всё оставшееся место. */
    <div className="flex items-center gap-1 pr-2">
      <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
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

      {/* Печать стикера этого короба — без раскрытия и прокрутки.
          На телефоне подпись прячем: в узкой полосе она не помещается,
          а иконка принтера понятна и без неё. */}
      {canPrintSticker && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={printing}
          title={`Печать стикера короба №${box.boxNumber}`}
          onClick={onPrintSticker}
        >
          <Icon
            name={printing ? 'Loader2' : 'Printer'}
            size={14}
            className={printing ? 'animate-spin sm:mr-1.5' : 'sm:mr-1.5'}
          />
          <span className="hidden sm:inline">
            {printing ? 'Готовим…' : 'Стикер'}
          </span>
        </Button>
      )}

      {canPrintWb && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={printing}
          title={`Печать стикера короба №${box.boxNumber}`}
          onClick={onPrintWbSticker}
        >
          <Icon
            name={printing ? 'Loader2' : 'Printer'}
            size={14}
            className={printing ? 'animate-spin sm:mr-1.5' : 'sm:mr-1.5'}
          />
          <span className="hidden sm:inline">
            {printing ? 'Готовим…' : 'Стикер'}
          </span>
        </Button>
      )}

      {/* Стикера ещё нет, но грузоместо заведено: площадка готовит файл.
          Забрать его тоже можно из полосы — короб раскрывать незачем. */}
      {canFetchLabel && (
        <Button
          size="sm"
          className="shrink-0 bg-[#005BFF] text-white hover:bg-[#0047cc]"
          disabled={fetchingLabel}
          title={`Получить этикетку короба №${box.boxNumber} у OZON`}
          onClick={onFetchLabel}
        >
          <Icon
            name={fetchingLabel ? 'Loader2' : 'Download'}
            size={14}
            className={fetchingLabel ? 'animate-spin sm:mr-1.5' : 'sm:mr-1.5'}
          />
          <span className="hidden sm:inline">
            {fetchingLabel ? 'Запрашиваем…' : 'Этикетка'}
          </span>
        </Button>
      )}
    </div>
  );
};

export default SupplyBoxCardHeader;