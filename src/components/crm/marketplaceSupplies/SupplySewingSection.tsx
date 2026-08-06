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
}

/** Прогресс производства по поставке: сколько изделий сшито, сколько ещё в работе,
 * и кнопка догрузки товаров в пошив. */
const SupplySewingSection = ({ orders, canAdd, onAdd }: SupplySewingSectionProps) => {
  const active = orders.filter((o) => !o.isCancelled);
  const done = active.filter((o) => o.sewingStatus === 'Готовые' || o.sewingStatus === 'Со склада');
  const inWork = active.filter((o) => IN_PROGRESS.includes(o.sewingStatus));
  const fresh = active.filter((o) => o.sewingStatus === 'Новый');

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Пошив по поставке ({active.length})</h2>
        {canAdd && (
          <Button size="sm" onClick={onAdd}>
            <Icon name="Plus" size={14} className="mr-1" />
            Догрузить товары
          </Button>
        )}
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default SupplySewingSection;
