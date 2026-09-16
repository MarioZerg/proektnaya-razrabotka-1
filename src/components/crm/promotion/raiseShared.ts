import { shortProductName } from '@/lib/shortProductName';
import type { CatalogItem } from '@/lib/priceRobotApi';

/** Новая цена после шага — так же, как считает сервер: два знака после запятой. */
export const raisedPrice = (price: number, stepPercent: number): number =>
  Math.round(price * (1 + stepPercent / 100) * 100) / 100;

export const formatRub = (n: number): string =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const catalogTitle = (item: CatalogItem): string =>
  shortProductName({
    product: item.name,
    material: item.material,
    width: item.width,
    height: item.height,
  });

export const chipClass = (on: boolean) =>
  `rounded-md border px-2.5 py-1 text-sm transition ${
    on
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-input bg-background hover:bg-muted'
  }`;
