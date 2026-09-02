import { marketplaceLogo } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

interface MarketplaceBadgeProps {
  /** Код площадки как он лежит в заказе: OZON, WB, Yandex. */
  marketplace?: string | null;
  className?: string;
}

/**
 * От какой площадки приехал товар.
 *
 * Кладовщик разбирает вещи разных маркетплейсов из одной тележки, и правила у них
 * разные: WB и Яндекс возвращают вещь целиком, OZON — поштучно. Раньше площадку
 * приходилось узнавать по номеру заказа, а он у всех выглядит одинаково.
 *
 * Цвета фирменные, как на самих площадках, — их узнают с одного взгляда, не читая.
 */
const MarketplaceBadge = ({ marketplace, className = '' }: MarketplaceBadgeProps) => {
  if (!marketplace) return null;
  // Код в базе пишут по-разному («Yandex», «yandex»), а подпись нужна одна.
  const key =
    Object.keys(marketplaceLogo).find(
      (k) => k.toLowerCase() === marketplace.toLowerCase(),
    ) || marketplace;
  const logo = marketplaceLogo[key];

  return (
    <span
      className={`inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] leading-none ${
        logo?.className || 'font-bold text-muted-foreground'
      } ${className}`}
    >
      {logo?.label || marketplace}
    </span>
  );
};

export default MarketplaceBadge;
