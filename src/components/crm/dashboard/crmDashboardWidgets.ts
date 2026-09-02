import { type DashboardSummary } from '@/lib/dashboardSummaryApi';
import { type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';

interface BuildWidgetsArgs {
  isCleaner: boolean;
  isCutter: boolean;
  isSewer: boolean;
  canSeeWarehouseWidgets: boolean;
  summary: DashboardSummary | null;
}

/**
 * Плитки дашборда по готовой сводке из базы.
 *
 * Вынесено из страницы 1:1 — тот же порядок, те же условия, те же подписи. Здесь
 * только сборка списка: цифры уже посчитаны сервером, роль и id он получил заранее
 * и отфильтровал по ним данные.
 */
export const buildDashboardWidgets = ({
  isCleaner,
  isCutter,
  isSewer,
  canSeeWarehouseWidgets,
  summary,
}: BuildWidgetsArgs): DashboardWidgetData[] => {
  if (isCleaner) return [];
  if (!summary) return [];

  // Все цифры уже посчитаны базой по тем же правилам, что раньше применялись
  // здесь: швея и закройщик видят ТОЛЬКО свою работу (сервер получил роль и id
  // и отфильтровал), «Новые задания» и «Раскроено» — общая очередь на всех.
  const list: DashboardWidgetData[] = [
    { label: 'Новые задания на пошив', value: summary.newOrders, icon: 'ListPlus', tone: 'default', path: '/crm/marketplace/sewing-items', stage: 'production', hint: 'Заказы приняты и ждут, когда их возьмут в работу' },
    // Швее и закройщику подписываем «У меня», чтобы цифра не читалась как объём
    // всего цеха: у них в этих виджетах теперь только собственные заказы.
    { label: isSewer ? 'У меня в пошиве' : 'Товары в пошиве', value: summary.inSewing, icon: 'Shirt', tone: 'default', path: '/crm/marketplace/sewing-items', stage: 'production', hint: isSewer ? 'Вещи, которые вы шьёте прямо сейчас' : 'Вещи в работе у швей' },
    // Швее раскрой не показываем совсем: она его не делает и повлиять на него
    // не может — цифра только отвлекает от собственной работы.
    ...(isSewer
      ? []
      : [{ label: isCutter ? 'У меня в закрое' : 'Товары в закрое', value: summary.inCutting, icon: 'Scissors', tone: 'default' as const, path: '/crm/marketplace/sewing-items', stage: 'production' as const, hint: isCutter ? 'Ткань, которую вы кроите прямо сейчас' : 'Ткань в работе у закройщиков' }]),
    // ?type=FBS — страница откроется сразу с фильтром по FBS, иначе показывала все заказы
    // Срочные FBS — это работа цеха, а не отдельная тревога: их шьют в общем
    // потоке, просто в первую очередь. Поэтому плитка стоит в производстве,
    // первой в цепочке, и остаётся красной — приоритет никуда не делся.
    { label: 'Срочные заказы (FBS)', value: summary.urgentFbs, icon: 'Zap', tone: 'urgent', path: '/crm/marketplace/sewing-items?type=FBS', stage: 'production', hint: 'Отгрузка сегодня — делать в первую очередь' },
    { label: 'Не отгруженные поставки в цех', value: summary.notShippedToWorkshop, icon: 'TruckElectric', tone: 'warning', path: '/crm/shipments/to-workshop', stage: 'warehouse', hint: 'Материал собран, но со склада ещё не уехал' },
    { label: 'Не принятые поставки в цехе', value: summary.notReceivedInWorkshop, icon: 'PackageX', tone: 'warning', path: '/crm/shipments/to-workshop', stage: 'warehouse', hint: 'Привезли в цех, но приёмку никто не подтвердил' },
    { label: isSewer || isCutter ? 'Мои на стикеровке' : 'Товары на стикеровке', value: summary.inStickering, icon: 'Tag', tone: 'default', path: '/crm/marketplace/sewing-items', stage: 'production', hint: 'Сшито и ждёт наклейки стикера маркетплейса' },
    // «Раскроено» — тоже не для швеи: это итог работы закройщиков, а очередь,
    // из которой швея берёт вещи, у неё в «Новых заданиях».
    ...(isSewer
      ? []
      : [{ label: 'Раскроено', value: summary.cut, icon: 'CheckCircle2', tone: 'default' as const, path: '/crm/marketplace/sewing-items', stage: 'production' as const, hint: 'Крой готов и передан швеям' }]),
  ];

  if (canSeeWarehouseWidgets) {
    const awaitingShelf = summary.awaitingShelf || 0;
    const awaitingShipLabel = summary.awaitingShipLabel || 0;
    const returnsPickedUp = summary.returnsPickedUp || 0;
    // Виджета «Товары к подбору со склада» больше нет: он показывал ВЕСЬ товар на
    // полках (сотни штук) и выглядел как гора работы, хотя это просто остаток.
    // Реальная задача кладовщика — вещи, подобранные под заказы: их и показываем
    // строкой «Заказы с полок».
    list.splice(4, 0, {
      label: 'Отменено — забрать из цеха на полку',
      value: awaitingShelf,
      icon: 'PackageCheck',
      tone: awaitingShelf > 0 ? 'urgent' : 'default',
      path: '/crm/inventory/goods-warehouse',
      stage: 'warehouse',
      hint: 'Заказ отменили — вещь надо вернуть из цеха на полку',
    });
    list.splice(5, 0, {
      label: 'Собрать с полок под заказы',
      value: awaitingShipLabel,
      icon: 'PackageSearch',
      tone: awaitingShipLabel > 0 ? 'urgent' : 'default',
      // Ведём сразу на сборку, а не на общий склад: кладовщику нужно
      // отсканировать вещь и напечатать стикер, а не смотреть остатки.
      path: '/crm/inventory/goods-picking',
      stage: 'warehouse',
      hint: 'Отсканировать вещь и напечатать стикер отправления',
    });
    // Вещи привезли с ПВЗ, но кладовщик их ещё не осмотрел. Пока они не лежат
    // на полке, товар считается непроверенным и в подбор не идёт.
    // Обе плитки ведут на склад товара: там кладовщик и принимает привезённое
    // с ПВЗ, и разбирает его. Страница «Приём возвратов» ему не нужна — на ней
    // видно всё движение возврата и принимаются решения по нему, а это работа
    // руководителя.
    list.push({
      label: 'Возвраты с ПВЗ — разобрать',
      value: returnsPickedUp,
      icon: 'PackageOpen',
      tone: returnsPickedUp > 0 ? 'urgent' : 'default',
      path: '/crm/inventory/goods-warehouse',
      stage: 'warehouse',
      hint: 'Привезли с пункта выдачи — осмотреть и разложить',
    });
    // Виджет «Возвраты — принять на склад» убран: он считал ВСЕ возвраты,
    // заведённые маркетплейсом (больше полутора тысяч за всё время), включая те,
    // которые кладовщик в глаза не видел и которые могут никогда не доехать.
    // Цифра выглядела как гора работы, хотя работой не была. Реальная задача
    // кладовщика — вещи, которые он сам отсканировал и привёз с ПВЗ: они в
    // виджете ниже.
    list.push({
      label: 'Рулоны с малым остатком',
      value: summary.lowStockRolls || 0,
      icon: 'AlertTriangle',
      tone: 'urgent',
      // ?low=1 — страница откроется сразу с включённым фильтром и покажет ровно
      // те рулоны, которые посчитаны в этом виджете. Раньше вела на общий список
      // из тысяч рулонов, и заканчивающиеся приходилось искать глазами.
      path: '/crm/inventory/rolls?low=1',
      stage: 'warehouse',
      hint: 'Меньше 20 погонных метров — пора заказывать',
    });
  }

  // Задвоенные заказы: одна вещь попала в систему дважды. Показываем плитку ТОЛЬКО
  // когда такие есть — в обычной ситуации она не занимает место на дашборде.
  // Молчать нельзя: на лишнюю вещь спишется материал и начислится зарплата.
  const duplicates = summary.duplicateOrders;
  if (duplicates > 0) {
    list.unshift({
      label: 'Задвоенные заказы — проверить',
      value: duplicates,
      icon: 'CopyX',
      tone: 'urgent',
      path: '/crm/marketplace/orders',
      stage: 'attention',
      hint: 'Одна вещь попала в систему дважды — проверить',
    });
  }

  if (isCutter) {
    // Закройщику показываем только то, что относится к его работе: что предстоит
    // раскроить, что уже в закрое и раскроено, срочные заказы и поставки материала
    // в цех. Остальные виджеты (пошив, стикеровка) — не его зона ответственности.
    // Сравниваем по СУТИ, а не по точному названию: у закройщика плитка
    // подписана «У меня в закрое», и список точных названий её отсеивал —
    // человек не видел собственных заказов, взятых в работу.
    const cutterWidgets = [
      'Новые задания',
      'в закрое',
      'Срочные заказы',
      'Не отгруженные поставки в цех',
      'Не принятые поставки в цехе',
      'Раскроено',
    ];
    return list.filter((w) => cutterWidgets.some((part) => w.label.includes(part)));
  }

  return list;
};

export default buildDashboardWidgets;
