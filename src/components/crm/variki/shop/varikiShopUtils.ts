import type { ShopItem } from '@/lib/varikiApi';

/** Кейс бокс: безлимитный лут шляпы, сертификаты не нужны. */
export const isBubbleCase = (item: Pick<ShopItem, 'animation'>) => item.animation === 'bubble_case';

/** Сегодня в виде ГГГГ-ММ-ДД — минимальная дата для поля выбора. */
export const todayIso = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(
    t.getDate(),
  ).padStart(2, '0')}`;
};

/** Дата в «01.09.2026» — читается привычнее, чем 2026-09-01. */
export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

/**
 * Доступен ли подарок к покупке сегодня.
 *
 * Считаем в виде строк ГГГГ-ММ-ДД: они сравниваются как даты без возни с
 * часовыми поясами, из-за которых подарок мог «закончиться» на день раньше.
 */
export const checkPeriod = (item: ShopItem) => {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  if (item.validFrom && iso < item.validFrom) {
    return { active: false, note: `В продаже с ${formatDate(item.validFrom)}` };
  }
  if (item.validTo && iso > item.validTo) {
    return { active: false, note: `Срок истёк ${formatDate(item.validTo)}` };
  }
  if (item.validTo) {
    return { active: true, note: `Купить до ${formatDate(item.validTo)}` };
  }
  return { active: true, note: '' };
};
