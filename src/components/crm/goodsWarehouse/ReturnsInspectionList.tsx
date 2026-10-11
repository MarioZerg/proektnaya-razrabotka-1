import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { shortProductName } from '@/lib/shortProductName';
import MarketplaceBadge from '@/components/crm/MarketplaceBadge';
import type { InspectionItem } from '@/lib/goodsWarehouseApi';
import { formatDateTime } from '@/lib/dateUtils';

interface ReturnsInspectionListProps {
  title?: string;
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET осмотра — не писать «на этом этапе пусто». */
  error?: string | null;
  items: InspectionItem[];
  visible: InspectionItem[];
  selected: number[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}

/** Список вещей текущего этапа: поиск по стикеру + таблица с выбором строк. */
const ReturnsInspectionList = ({
  title,
  loading,
  error = null,
  items,
  visible,
  selected,
  search,
  onSearchChange,
  onToggle,
  onToggleAll,
}: ReturnsInspectionListProps) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-2">
      <h2 className="font-semibold">{title}</h2>

      {/* Поиск нужен там, где вещей много и они физически в руках у кладовщика:
          он пикает стикер с пакета и сразу видит нужную строку. */}
      {!loading && items.length > 0 && (
        <div className="relative max-w-xl">
          <Icon
            name="Search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Отсканируйте стикер возврата или введите товар, размер, заказ"
            className="h-11 pl-9 pr-9"
            autoComplete="off"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              title="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" size={16} />
            </button>
          )}
        </div>
      )}

      {/* Явная кнопка выбора всех: галочка в шапке маленькая и на тёмном фоне
          терялась, поэтому полсотни вещей отмечали по одной. Здесь же видно,
          сколько строк сейчас в списке. */}
      {!loading && visible.length > 0 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onToggleAll}>
            <Icon
              name={
                selected.length === visible.length ? 'SquareMinus' : 'SquareCheckBig'
              }
              size={16}
              className="mr-2"
            />
            {selected.length === visible.length
              ? 'Снять выделение'
              : `Выбрать все (${visible.length})`}
          </Button>
          {selected.length > 0 && (
            <span className="text-sm text-muted-foreground">
              Отмечено: {selected.length} из {visible.length}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : items.length === 0 ? (
        error ? null : (
        <p className="text-sm text-muted-foreground">На этом этапе пусто</p>
        )
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          По запросу «{search}» ничего не нашлось. Возможно, вещь ещё не отмечена как
          привезённая с пункта выдачи
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((i) => {
            const size = i.width && i.height ? `${i.width}×${i.height}` : '';
            const when = i.inspectedAt || i.takenAt || i.receivedAt;
            const who = i.inspectedByName || i.takenByName;
            const fromWorkshop = i.receiveReason === 'cancelled_labeled';
            const repeat = !fromWorkshop && !i.historyLost && (i.returnCount || 0) > 1;
            const fresh = (i.latestClientOrder || '').trim();
            const oldTail = (i.previousOrderNumbers || '').trim();
            const linked = (i.clientOrderNumber || '').trim();
            const clientNo =
              fresh ||
              oldTail ||
              (repeat && linked && linked !== (i.orderNumber || '') ? linked : '');
            const clientIsOld = !fresh && Boolean(oldTail);
            return (
              <div
                key={i.id}
                className={`relative flex min-w-0 items-start gap-2 overflow-hidden rounded-md border border-border bg-card py-2 pl-3 pr-3 ${
                  fromWorkshop ? 'bg-sky-50/70' : i.historyLost ? 'bg-amber-50/70' : ''
                }`}
              >
                <span
                  className={`absolute inset-y-0 left-0 w-1 ${
                    fromWorkshop ? 'bg-sky-500' : (i.returnCount || 0) >= 3 ? 'bg-destructive' : 'bg-amber-500'
                  }`}
                />
                <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.includes(i.id)}
                    onCheckedChange={() => onToggle(i.id)}
                    aria-label={`Отметить ${i.storageBarcode}`}
                    className="h-4 w-4 shrink-0"
                  />
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">

                <div className="flex min-w-0 flex-col items-start gap-0.5">
                  {fromWorkshop && (
                    <span className="rounded-br-md bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      С цеха
                    </span>
                  )}
                  {i.historyLost && (
                    <span className="rounded-br-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      Вручную
                    </span>
                  )}
                  {when && (
                    <span className="whitespace-nowrap text-[11px] leading-tight text-muted-foreground">
                      {formatDateTime(when)}
                    </span>
                  )}
                  {who && <span className="text-[11px] leading-tight">{who}</span>}
                  <MarketplaceBadge marketplace={i.marketplace} />
                </div>

                <button
                  type="button"
                  onClick={() => navigate(`/crm/inventory/goods/${i.id}`)}
                  className="flex min-w-0 flex-col items-center px-2 text-center"
                >
                  <p className="break-words text-base font-extrabold leading-tight" title={i.product || ''}>
                    {i.material || shortProductName(i)}
                  </p>
                  {size && <span className="text-sm font-semibold">{size}</span>}
                </button>

                <div className="flex flex-col items-end justify-self-end text-right leading-tight">
                  <span className="font-mono-tech text-sm font-bold">{i.storageBarcode}</span>
                  {repeat && clientNo && (
                    <span className="font-mono-tech text-xs font-semibold leading-tight">
                      {clientIsOld ? `было ${clientNo}` : clientNo}
                    </span>
                  )}
                  {i.orderNumber && i.orderNumber !== clientNo && (
                    <button
                      type="button"
                      onClick={() => navigate(`/crm/inventory/goods/${i.id}`)}
                      className="font-mono-tech text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {i.orderNumber}
                    </button>
                  )}
                </div>

                {fromWorkshop && (
                  <p className="col-span-full pl-3 text-xs font-medium text-sky-700">
                    Отмена после стикеровки в цехе — сразу на полку
                  </p>
                )}
                {!fromWorkshop && i.historyLost && (
                  <p className="col-span-full pl-3 text-xs font-medium text-amber-700">
                    История потеряна · добавлен вручную
                  </p>
                )}
                {!fromWorkshop && !i.historyLost && (i.returnCount || 0) > 1 && (
                  <p
                    className={`col-span-full pl-3 text-xs font-medium ${
                      (i.returnCount || 0) >= 3 ? 'text-destructive' : 'text-amber-700'
                    }`}
                  >
                    Возвращали {i.returnCount} раза — осмотрите
                  </p>
                )}
                {(i.disposeReason || i.lostReason) && (
                  <p className="col-span-full text-xs text-destructive">
                    {i.disposeReason || i.lostReason}
                  </p>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReturnsInspectionList;