import type { GoodsStatus, ReceiveReason } from '@/lib/goodsWarehouseApi';

export { formatDateTime as formatDate } from '@/lib/dateUtils';

export const statusLabels: Record<GoodsStatus, string> = {
  // Вещь висит на разборе у производства: упаковщица её ещё не перепаковала и
  // складской стикер не наклеен.
  awaiting_shelf: 'На разборе с производства',
  // Кладовщик разбирает привезённое с ПВЗ: часть уйдёт на полку, часть — в цех.
  checking: 'На разборе с маркетплейса',
  // Приехал назад с маркетплейса и лежит у кладовщика — ещё не разобран.
  mp_return: 'Возврат с маркетплейса',
  // Передан в цех, упаковщица осматривает вещь.
  repacking: 'На проверке',
  // Упаковщица закончила и наклеила стикер хранения — ждёт кладовщика.
  inspected: 'Осмотрено',
  taken: 'Забрано с производства',
  to_dispose: 'На утилизацию',
  in_stock: 'На хранении',
  // Вещь снята с полки и отстикерована — дальше её сканируют в поставку.
  picking: 'На сборке',
  // Сшит в цехе и застикерован: лежит в контейнере, кладовщик сканирует его в поставку.
  awaiting_supply: 'На поставку',
  reserved: 'Зарезервирован',
  shipped: 'Отгружен',
  lost: 'Утерян',
};

export const statusVariant: Record<GoodsStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  awaiting_shelf: 'destructive',
  checking: 'secondary',
  mp_return: 'destructive',
  repacking: 'secondary',
  inspected: 'default',
  taken: 'default',
  to_dispose: 'destructive',
  in_stock: 'secondary',
  picking: 'default',
  awaiting_supply: 'default',
  reserved: 'default',
  shipped: 'outline',
  lost: 'destructive',
};

/** Причина попадания товара на склад — чтобы кладовщик понимал происхождение вещи. */
export const reasonLabels: Record<ReceiveReason, string> = {
  cancelled: 'Отмена клиентом',
  return: 'Возврат',
  manual: 'Принят вручную',
  // Вещь заводят на склад руками — и админ, и кладовщик. Раньше здесь было
  // «Добавил админ», и работа кладовщика подписывалась чужим именем.
  admin: 'Добавлен вручную',
  individual: 'Индивидуальный пошив',
};

export const reasonIcons: Record<ReceiveReason, string> = {
  cancelled: 'XCircle',
  return: 'Undo2',
  manual: 'Hand',
  admin: 'ShieldCheck',
  individual: 'UserCheck',
};

export const reasonClass: Record<ReceiveReason, string> = {
  cancelled: 'bg-orange-100 text-orange-700 hover:bg-orange-100',
  return: 'bg-sky-100 text-sky-700 hover:bg-sky-100',
  manual: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  admin: 'bg-violet-100 text-violet-700 hover:bg-violet-100',
  individual: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
};