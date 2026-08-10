import type { InspectionStage } from '@/lib/goodsWarehouseApi';

/**
 * Шесть этапов движения возврата — от приёмки до полки.
 *
 * Порядок важен: виджеты стоят в том же порядке, в каком вещь физически проходит склад
 * и цех. Кладовщик читает строку слева направо и сразу видит, где скопилась работа.
 */
export const INSPECTION_STAGES: {
  key: InspectionStage;
  title: string;
  hint: string;
  icon: string;
  /** Цвет плитки: тревожные этапы выделяем, спокойные — нейтральны. */
  tone: 'default' | 'warning' | 'danger' | 'success';
}[] = [
  {
    key: 'fromReturn',
    title: 'Товар с возврата',
    hint: 'Приняты, ждут отправки в цех',
    icon: 'Undo2',
    tone: 'default',
  },
  {
    key: 'atPackers',
    title: 'На осмотре у упаковщиц',
    hint: 'Переданы в цех, осматриваются',
    icon: 'Search',
    tone: 'warning',
  },
  {
    key: 'inspected',
    title: 'Уже осмотрено',
    hint: 'Со стикером, ждут кладовщика',
    icon: 'CircleCheck',
    tone: 'success',
  },
  {
    key: 'taken',
    title: 'Забрано с цеха',
    hint: 'На руках, полка не определена',
    icon: 'PackageOpen',
    tone: 'warning',
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
