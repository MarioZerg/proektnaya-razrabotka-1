import type { GoodsStatus, GoodsWarehouseItem, ReceiveReason } from '@/lib/goodsWarehouseApi';
import type { WorkZone } from '@/lib/workZone';

export { formatDateTime as formatDate } from '@/lib/dateUtils';

/**
 * Можно ли печатать ярлык маркетплейса на эту вещь из списка склада.
 *
 * Печатаем ТОЛЬКО на вещь со статусом «На поставку» — то есть ту, которую кладовщик
 * уже застикеровал у себя в подборе и нажал «Готово — на поставку».
 *
 * Почему не на «На сборке»: вещь в подборе кладовщик стикерует сам, сканером, держа
 * её в руках. Если ярлык на неё можно напечатать ещё и отсюда, из общего списка, —
 * тот же ярлык уходит из принтера второй раз. На складе появляются два одинаковых
 * ярлыка на одно отправление: один на вещи, второй ничей. Второй легко наклеить на
 * соседнюю вещь, и к покупателю уезжает чужой товар, а маркетплейс выставляет штраф.
 *
 * Так список старшего кладовщика становится местом ПЕРЕпечатки: сюда попадает только
 * то, что уже собрано и отправлено на поставку, — если наклейка порвалась или
 * потерялась при укладке в короб.
 *
 * Вещь «На хранении» лежит на полке свободной и ярлыка отправления не получает,
 * даже если за ней когда-то был закреплён заказ.
 */
export const canPrintMarketplaceLabel = (item: GoodsWarehouseItem): boolean =>
  Boolean(item.reservedOrderId) && item.status === 'awaiting_supply';

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
/**
 * Чья это сейчас работа: цеха, склада или обоих сразу.
 *
 * Вещь путешествует между цехом и складом, и по названию статуса не всегда очевидно,
 * кто за неё отвечает прямо сейчас. Цветная метка снимает вопрос: фиолетовый —
 * производство, зелёный — склад, двухцветный — момент передачи из рук в руки.
 */
export const statusZone: Record<GoodsStatus, WorkZone> = {
  // Упаковщица ещё не перепаковала вещь и не наклеила складской стикер — она в цехе,
  // но её уже ждёт кладовщик: это стык.
  awaiting_shelf: 'both',
  // Кладовщик разбирает привезённое: часть уйдёт в цех, часть — на полку.
  checking: 'both',
  mp_return: 'both',
  // Вещь в цехе у упаковщицы.
  repacking: 'production',
  // Упаковщица закончила и наклеила стикер — вещь ждёт, когда её заберёт кладовщик.
  inspected: 'both',
  taken: 'both',
  // Решение об утилизации принимает производство: вещь бракуют по состоянию.
  to_dispose: 'production',
  // Дальше всё складское: полка, сборка, поставка, отгрузка.
  in_stock: 'warehouse',
  picking: 'warehouse',
  awaiting_supply: 'warehouse',
  reserved: 'warehouse',
  shipped: 'warehouse',
  lost: 'warehouse',
};
