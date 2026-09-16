import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Material, Shop } from '@/lib/materialsApi';
import MaterialShopsBadges from '@/components/crm/materials/MaterialShopsBadges';

interface MaterialsCardsProps {
  materials: Material[];
  typeById: Map<number, string>;
  shopById: Map<number, Shop>;
  onEdit: (m: Material) => void;
  onAskDelete: (id: number) => void;
}

/** Мобильный вид справочника материалов. Восемь колонок таблицы на телефоне
 *  уезжали вбок вместе с кнопками правки — их просто не было видно. */
const MaterialsCards = ({
  materials,
  typeById,
  shopById,
  onEdit,
  onAskDelete,
}: MaterialsCardsProps) => (
  <div className="space-y-3">
    {materials.map((m) => (
      <div
        key={m.id}
        className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="break-words font-semibold">{m.name}</div>
            <div className="text-xs text-muted-foreground">
              {typeById.get(m.typeId) || '—'} · #{m.id}
            </div>
          </div>
          <Badge
            variant={m.status === 'active' ? 'secondary' : 'outline'}
            className="shrink-0"
          >
            {m.status === 'active' ? 'Активен' : 'Архив'}
          </Badge>
        </div>

        {m.requiresOverlock && !(m.shops && m.shops.length > 0) && (
          <Badge
            variant="outline"
            className="mt-2 gap-1 border-fuchsia-300 bg-fuchsia-50 font-normal text-fuchsia-700"
          >
            <Icon name="Scissors" size={11} />
            Оверлок
          </Badge>
        )}

        <div className="mt-2 space-y-1 text-sm">
          <div className="min-w-0">
            <span className="text-muted-foreground">Магазины: </span>
            <div className="mt-1">
              <MaterialShopsBadges material={m} shopById={shopById} />
            </div>
          </div>
          <div>
            <span className="text-muted-foreground">Ед. изм.: </span>
            {m.unit}
          </div>
          <div>
            <span className="text-muted-foreground">Средняя цена: </span>
            {m.avgCost > 0 ? (
              `${m.avgCost.toFixed(2)} ₽`
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </div>

        <div className="mt-3 flex min-w-0 flex-wrap gap-2">
          <Button size="sm" variant="secondary" className="min-w-0 flex-1" onClick={() => onEdit(m)}>
            <Icon name="Pencil" size={14} className="mr-1" />
            Изменить
          </Button>
          {m.hasMovements ? (
            <Button size="sm" variant="destructive" className="min-w-0 flex-1" disabled>
              <Icon name="Lock" size={14} className="mr-1" />
              В работе
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              className="min-w-0 flex-1"
              onClick={() => onAskDelete(m.id)}
            >
              <Icon name="Trash2" size={14} className="mr-1" />
              Удалить
            </Button>
          )}
        </div>
      </div>
    ))}
  </div>
);

export default MaterialsCards;
