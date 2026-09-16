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

/**
 * Приводит строку к виду, в котором её можно сравнивать с поисковым запросом.
 *
 * Размер пишут как придётся: «200x230», «200х230» русской буквой, «200*230»,
 * «200 x 230». Искалось буквально — и запрос с русской «х» не находил ничего,
 * хотя товар был на экране. Обе стороны сравнения приводим к одному виду.
 */
export const normalizeSearch = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[х×*]/g, 'x')
    .replace(/\s*x\s*/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();

export const chipClass = (on: boolean) =>
  `rounded-md border px-2.5 py-1 text-sm transition ${
    on
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-input bg-background hover:bg-muted'
  }`;