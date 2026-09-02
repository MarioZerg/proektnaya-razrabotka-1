import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { shortProductName } from '@/lib/shortProductName';
import MarketplaceBadge from '@/components/crm/MarketplaceBadge';
import type { InspectionItem } from '@/lib/goodsWarehouseApi';

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  // Московское время — единое для всей системы, независимо от часов устройства.
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

interface ReturnsInspectionListProps {
  title?: string;
  loading: boolean;
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
        <p className="text-sm text-muted-foreground">На этом этапе пусто</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          По запросу «{search}» ничего не нашлось. Возможно, вещь ещё не отмечена как
          привезённая с пункта выдачи
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                {/* Галочка «выбрать все» стоит на ТЁМНОЙ шапке, а рамка у неё по
                    умолчанию тоже тёмная — на этом фоне её попросту не было видно,
                    и админ отмечал полсотни вещей по одной. Перекрашиваем в светлый
                    цвет шапки. */}
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.length === visible.length && visible.length > 0}
                    onCheckedChange={onToggleAll}
                    title={
                      selected.length === visible.length && visible.length > 0
                        ? 'Снять выделение со всех'
                        : `Выбрать все (${visible.length})`
                    }
                    className="border-primary-foreground data-[state=checked]:border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
                  />
                </TableHead>
                <TableHead className="text-primary-foreground">Товар</TableHead>
                <TableHead className="text-primary-foreground">Ткань</TableHead>
                <TableHead className="text-primary-foreground">Размер</TableHead>
                <TableHead className="text-primary-foreground">Кто осмотрел</TableHead>
                <TableHead className="text-primary-foreground">Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((i) => (
                <TableRow key={i.id} className="hover:bg-muted/60">
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.includes(i.id)}
                      onCheckedChange={() => onToggle(i.id)}
                    />
                  </TableCell>
                  <TableCell
                    className="cursor-pointer"
                    onClick={() => navigate(`/crm/inventory/goods/${i.id}`)}
                  >
                    <div className="font-medium" title={i.product || ''}>
                      {shortProductName(i)}
                    </div>
                    {/* От какой площадки товар: WB и Яндекс возвращают вещь
                        целиком, OZON — поштучно, и разбирают их по-разному.
                        По номеру заказа площадку не отличить. */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <MarketplaceBadge marketplace={i.marketplace} />
                      <span>
                        {i.orderNumber || '—'} · {i.storageBarcode}
                      </span>
                    </div>
                    {/* Сколько раз вещь уже возвращали — главное для решения
                        «осмотреть или сразу на полку». Покупатели не возвращают
                        исправный товар снова и снова: со второго возврата
                        подсвечиваем, с третьего — красным. */}
                    {/* ОТМЕНА ПОСЛЕ СТИКЕРОВКИ — не возврат от покупателя.
                        Вещь сшили, упаковали и заклеили ярлыком маркетплейса, и
                        уже после этого заказ отменили. К покупателю она не
                        уезжала, осматривать её незачем: сразу на полку со
                        стикером хранения. */}
                    {i.receiveReason === 'cancelled_labeled' && (
                      <div className="text-xs font-medium text-sky-700">
                        Отмена после стикеровки в цехе — сразу на полку
                      </div>
                    )}
                    {i.historyLost ? (
                      <div className="text-xs font-medium text-amber-600">
                        История потеряна · добавлен вручную
                      </div>
                    ) : (i.returnCount || 0) > 1 ? (
                      <div
                        className={`text-xs font-medium ${
                          (i.returnCount || 0) >= 3 ? 'text-destructive' : 'text-amber-600'
                        }`}
                      >
                        Возвращали {i.returnCount} раза — осмотрите
                      </div>
                    ) : null}
                    {(i.disposeReason || i.lostReason) && (
                      <div className="text-xs text-destructive">
                        {i.disposeReason || i.lostReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{i.material || '—'}</TableCell>
                  <TableCell>
                    {i.width && i.height ? `${i.width}×${i.height}` : '—'}
                  </TableCell>
                  <TableCell>{i.inspectedByName || i.takenByName || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(i.inspectedAt || i.takenAt || i.receivedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default ReturnsInspectionList;