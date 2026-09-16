import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Material, Shop } from '@/lib/materialsApi';

/** Кому подходит материал и как обрабатывают край — одни и те же метки в таблице
 *  и в карточках, чтобы на телефоне и на компьютере читалось одинаково. */
const MaterialShopsBadges = ({
  material,
  shopById,
}: {
  material: Material;
  shopById: Map<number, Shop>;
}) => {
  if (!material.shops || material.shops.length === 0) {
    return <span className="text-xs text-muted-foreground">Все магазины</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {material.shops.map((s) => {
        const shop = shopById.get(s.shopId);
        if (!shop) return null;
        return (
          <Badge
            key={s.shopId}
            variant="outline"
            className={`gap-1 font-normal ${
              s.requiresOverlock ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700' : ''
            }`}
          >
            {shop.name}
            {s.requiresOverlock && <Icon name="Scissors" size={11} />}
          </Badge>
        );
      })}
    </div>
  );
};

export default MaterialShopsBadges;
