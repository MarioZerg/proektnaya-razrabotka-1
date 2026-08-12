import type { InspectionStage } from '@/lib/goodsWarehouseApi';

/**
 * Этапы движения возврата — от пункта выдачи до полки хранения.
 *
 * Порядок важен: виджеты стоят в том же порядке, в каком вещь физически проходит склад
 * и цех. Кладовщик читает строку слева направо и сразу видит, где скопилась работа.
 *
 * Путь вещи целиком:
 *   1. Возврат с маркетплейса — кладовщик привёз с ПВЗ, ещё не разобрал;
 *   2. На разборе с маркетплейса — разбирает: часть на полку, часть в цех на осмотр;
 *   3. На проверке — упаковщица осматривает вещь в цехе;
 *   4. Осмотрено — упаковщица закончила и наклеила стикер: кладовщик забирает вещь
 *      из цеха и кладёт на полку прямо отсюда;
 *   5. На утилизацию / Утилизировано — брак.
 *
 * Этапа «Забрано с производства» больше нет: он значил «вещь на руках, полку назначу
 * потом» и дублировал «Осмотрено» — с обоих кладовщик делал одно и то же действие.
 * Промежуточный шаг только плодил вещи, висящие без места.
 */
export const INSPECTION_STAGES: {
  /** readyShelf сюда не входит: это служебный запрос окна раскладки, не этап пути. */
  key: Exclude<InspectionStage, 'readyShelf'>;
  title: string;
  hint: string;
  icon: string;
  /** Цвет плитки: тревожные этапы выделяем, спокойные — нейтральны. */
  tone: 'default' | 'warning' | 'danger' | 'success';
}[] = [
  {
    key: 'fromMarketplace',
    title: 'Возврат с маркетплейса',
    hint: 'Привезли с ПВЗ, ещё не разобрали',
    icon: 'Undo2',
    tone: 'warning',
  },
  {
    key: 'fromReturn',
    title: 'На разборе с маркетплейса',
    hint: 'Кладовщик решает: полка или цех',
    icon: 'PackageSearch',
    tone: 'default',
  },
  {
    key: 'atPackers',
    title: 'На проверке',
    hint: 'В цехе, упаковщица осматривает',
    icon: 'Search',
    tone: 'warning',
  },
  {
    key: 'inspected',
    title: 'Осмотрено',
    hint: 'Со стикером хранения — положите на полку',
    icon: 'CircleCheck',
    tone: 'success',
  },
  {
    key: 'toDispose',
    title: 'На утилизацию',
    hint: 'Брак и плохое качество',
    icon: 'TriangleAlert',
    tone: 'danger',
  },
  {
    key: 'disposed',
    title: 'Утилизировано',
    hint: 'Списано администратором',
    icon: 'Trash2',
    tone: 'default',
  },
];

/** Классы плитки по тону — чтобы текст всегда читался на своём фоне. */
export const toneClass: Record<string, string> = {
  default: 'border-border bg-card hover:bg-muted/50',
  warning: 'border-amber-300 bg-amber-50 hover:bg-amber-100',
  danger: 'border-destructive/40 bg-destructive/5 hover:bg-destructive/10',
  success: 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100',
};

export const toneIconClass: Record<string, string> = {
  default: 'text-muted-foreground',
  warning: 'text-amber-600',
  danger: 'text-destructive',
  success: 'text-emerald-600',
};