import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import SupplySection from '@/components/crm/marketplaceSupplies/SupplySection';
import type { SupplySewingOrder } from '@/lib/marketplaceSuppliesApi';

/** Этапы, на которых изделие уже в производстве: ткань раскроена или идёт пошив. */
const IN_PROGRESS = ['На раскрое', 'Раскроено', 'В работе', 'Стикеровка'];

const statusStyle: Record<string, string> = {
  Новый: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  'На раскрое': 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  Раскроено: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  'В работе': 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  Стикеровка: 'bg-violet-100 text-violet-800 hover:bg-violet-100',
  Готовые: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
  'Со склада': 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
};

interface SupplySewingSectionProps {
  orders: SupplySewingOrder[];
  /** Догрузка доступна менеджеру, пока поставка не уехала. */
  canAdd: boolean;
  onAdd: () => void;
  /**
   * Убрать товар из состава — менеджеру и администратору, пока поставка не уехала.
   *
   * Раньше состав правился только в одну сторону, догрузкой: заявку на площадке
   * урезали, а лишняя позиция так и оставалась в плане производства.
   */
  canRemove?: boolean;
  onRemove?: (order: SupplySewingOrder) => void;
  /** На шаге «Пошив» список и есть работа шага — открываем сразу. */
  defaultOpen?: boolean;
}

/** Прогресс производства по поставке: сколько изделий сшито, сколько ещё в работе,
 * и кнопка догрузки товаров в пошив. */
const SupplySewingSection = ({
  orders,
  canAdd,
  onAdd,
  canRemove = false,
  onRemove,
  defaultOpen = false,
}: SupplySewingSectionProps) => {
  const all = orders.filter((o) => !o.isCancelled);
  // Взятое готовым с полки — не пошив: считаем отдельно, чтобы не было
  // «Сшито 33 из 33», когда никто ничего не шил.
  const fromStock = all.filter((o) => o.sewingStatus === 'Со склада');
  const active = all.filter((o) => o.sewingStatus !== 'Со склада');
  const done = active.filter((o) => o.sewingStatus === 'Готовые');
  const inWork = active.filter((o) => IN_PROGRESS.includes(o.sewingStatus));
  const fresh = active.filter((o) => o.sewingStatus === 'Новый');

  return (
    <SupplySection
      title={`Состав поставки (${all.length})`}
      summary={
        all.length > 0 ? (
          <span>
            {active.length > 0 && (
              <>
                Сшито <b className="text-emerald-700">{done.length}</b> из {active.length}
              </>
            )}
            {active.length > 0 && fromStock.length > 0 && ' · '}
            {fromStock.length > 0 && (
              <>
                Со склада <b className="text-emerald-700">{fromStock.length}</b>
              </>
            )}
          </span>
        ) : undefined
      }
      defaultOpen={defaultOpen}
    >
      <div className="space-y-2">
      {canAdd && (
        <div>
          <Button size="sm" className="w-full sm:w-auto" onClick={onAdd}>
            <Icon name="Plus" size={14} className="mr-1" />
            Догрузить товары
          </Button>
        </div>
      )}

      {all.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {fromStock.length > 0 && (
            <span className="rounded-md border border-border px-3 py-1.5">
              Со склада (готовое): <b className="text-emerald-700">{fromStock.length}</b>
            </span>
          )}
          <span className="rounded-md border border-border px-3 py-1.5">
            Сшито: <b className="text-emerald-700">{done.length}</b> из {active.length}
          </span>
          <span className="rounded-md border border-border px-3 py-1.5">
            В работе: <b className="text-blue-700">{inWork.length}</b>
          </span>
          <span className="rounded-md border border-border px-3 py-1.5">
            Не начаты: <b>{fresh.length}</b>
          </span>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          По этой поставке пока ничего не шьётся
          {canAdd && ' — догрузите товары, чтобы отправить их в производство'}
        </p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">Заказ</TableHead>
                <TableHead className="text-primary-foreground">Товар</TableHead>
                <TableHead className="text-primary-foreground">Материал</TableHead>
                <TableHead className="text-primary-foreground">Размер</TableHead>
                <TableHead className="text-primary-foreground">Этап</TableHead>
                {canRemove && <TableHead className="text-primary-foreground" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className={o.isCancelled ? 'bg-destructive/10' : undefined}>
                  <TableCell className="font-medium">
                    <span className="break-all">{o.orderNumber}</span>
                    {o.source === 'manual' && (
                      <Badge variant="outline" className="ml-1.5 px-1.5 py-0 text-[10px]">
                        догружен
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{o.product || '—'}</TableCell>
                  <TableCell>{o.material || '—'}</TableCell>
                  <TableCell>{o.width && o.height ? `${o.width}×${o.height}` : '—'}</TableCell>
                  <TableCell>
                    {o.isCancelled ? (
                      <Badge variant="destructive">Отменён</Badge>
                    ) : (
                      <Badge className={statusStyle[o.sewingStatus] || ''}>{o.sewingStatus}</Badge>
                    )}
                  </TableCell>
                  {/* Убрать можно только нетронутое: «Новый» (никто не брал в
                      работу) и «Со склада» (вещь просто вернётся на полку).
                      Раскроенное и сшитое не трогаем — ткань уже потрачена,
                      работа сделана и оплачена. */}
                  {canRemove && (
                    <TableCell className="w-10">
                      {(o.sewingStatus === 'Новый' || o.sewingStatus === 'Со склада') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Убрать товар из состава поставки"
                          onClick={() => onRemove?.(o)}
                        >
                          <Icon name="Trash2" size={14} />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      </div>
    </SupplySection>
  );
};

export default SupplySewingSection;