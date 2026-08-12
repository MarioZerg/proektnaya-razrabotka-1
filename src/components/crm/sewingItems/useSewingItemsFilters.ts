import { useState } from 'react';
import type { Order, SewingStatus } from '@/lib/ordersApi';
import type { Material } from '@/lib/materialsApi';
import type { StatusTab } from '@/components/crm/sewingItems/sewingItemsShared';

interface UseSewingItemsFiltersArgs {
  orders: Order[];
  materials: Material[];
  visibleTabs: StatusTab[];
  isCutter: boolean;
  isSewer: boolean;
  isPacker: boolean;
  userId: number | undefined;
  /** Цех текущей открытой смены сотрудника. Производственные роли видят заказы только
   * своего цеха: перейдя в другой цех, упаковщица не должна видеть чужие заказы. */
  effectiveWorkshopId?: number | null;
}

/** Вкладки статусов, фильтры поиска/типа/сотрудника/материала/размера/цеха и производные
 * от них списки (постранично, счётчики вкладок, итоги по метражу/штукам). */
export const useSewingItemsFilters = ({
  orders,
  materials,
  visibleTabs,
  isCutter,
  isSewer,
  isPacker,
  userId,
  effectiveWorkshopId,
}: UseSewingItemsFiltersArgs) => {
  const [activeTab, setActiveTab] = useState<SewingStatus>(visibleTabs[0]?.value || 'Новый');
  const [page, setPage] = useState(1);

  const [searchQuery, setSearchQuery] = useState('');
  /**
   * Тип заказа можно задать в ссылке (?type=FBS) — так виджет «Срочные заказы (FBS)»
   * на дашборде открывает страницу сразу с нужным фильтром, а не со всем списком.
   */
  const [typeFilter, setTypeFilter] = useState(
    () => new URLSearchParams(window.location.search).get('type') || 'all'
  );
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [widthFilter, setWidthFilter] = useState('all');
  const [heightFilter, setHeightFilter] = useState('all');
  const [workshopFilter, setWorkshopFilter] = useState('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState('all');
  // Период выполнения работы — только для вкладки «Готовые». Швея и закройщик сверяют
  // по нему свою выработку: «что я сделала за эту неделю». Пустые значения = без границ.
  const [doneFrom, setDoneFrom] = useState('');
  const [doneTo, setDoneTo] = useState('');

  // Упаковщица весь конвейер видит только для просмотра — реальные действия она выполняет
  // на отдельном терминале стикеровки (Kiosk), а не на этой странице. Швея не может ничего
  // делать с заказами на вкладке "Стикеровка" — она их только отправила и ждёт закрытия.
  const isReadOnlyTab =
    isPacker || (activeTab === 'Раскроено' && isCutter) || (activeTab === 'Стикеровка' && isSewer);

  // Порядок на всех вкладках одинаковый: сверху самые давние заказы покупателей —
  // они горят, их и надо разбирать первыми. Считаем по дате оформления заказа на
  // маркетплейсе, а не по дате загрузки к нам: заказы приезжают пачками, и у сотни
  // заказов дата загрузки одна и та же — очередь по ней не выстроить.
  // На вкладке «Новый» дополнительно поднимаем FBS: у них сжатые сроки отгрузки,
  // и система раздаёт их в раскрой первыми — список должен совпадать с очередью.
  const ordersInTab = orders
    .filter((o) => o.sewingStatus === activeTab)
    .sort((a, b) => {
      if (activeTab === 'Новый') {
        const fbs = Number(b.orderType === 'FBS') - Number(a.orderType === 'FBS');
        if (fbs !== 0) return fbs;
      }
      const da = new Date(a.marketplaceCreatedAt || a.createdAt).getTime();
      const db = new Date(b.marketplaceCreatedAt || b.createdAt).getTime();
      return da - db;
    });

  const filteredOrders = ordersInTab.filter((o) => {
    if (searchQuery.trim() && !o.orderNumber.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    // «Юр. лицо» — не тип заказа, а признак покупателя: такие заказы бывают
    // и FBS, и FBO, поэтому проверяем отдельным условием.
    if (typeFilter === 'legal' && !o.isLegalEntity) return false;
    if (typeFilter !== 'all' && typeFilter !== 'legal' && o.orderType !== typeFilter) return false;
    if (employeeFilter !== 'all' && String(o.assignedUserId) !== employeeFilter) return false;
    if (materialFilter !== 'all' && o.material !== materials.find((m) => String(m.id) === materialFilter)?.name) return false;
    if (widthFilter !== 'all' && String(o.width) !== widthFilter) return false;
    if (heightFilter !== 'all' && String(o.height) !== heightFilter) return false;
    if (workshopFilter !== 'all' && String(o.workshopId) !== workshopFilter) return false;
    // Жёсткая привязка к цеху смены: упаковщица, швея и закройщик видят ТОЛЬКО заказы того
    // цеха, где сейчас открыта их смена. Раньше упаковщица, зайдя в другой цех, продолжала
    // видеть заказы всех цехов сразу.
    if (
      (isPacker || isSewer || isCutter) &&
      effectiveWorkshopId &&
      o.workshopId &&
      o.workshopId !== effectiveWorkshopId
    ) {
      return false;
    }
    if (marketplaceFilter !== 'all' && o.marketplace !== marketplaceFilter) return false;
    // Период считаем по СВОЕЙ дате: закройщик — по дате раскроя, швея — по дате пошива.
    // Иначе в отчёт попадали бы вещи, которые человек сделал в другой день: заказ мог
    // пролежать в очереди неделю между раскроем и пошивом.
    if (activeTab === 'Готовые' && (doneFrom || doneTo)) {
      const own = isCutter ? o.cutAt : isSewer ? o.sewnAt : o.cutAt || o.sewnAt;
      if (!own) return false;
      const day = own.slice(0, 10);
      if (doneFrom && day < doneFrom) return false;
      if (doneTo && day > doneTo) return false;
    }
    // Владение по вкладкам: закройщик на "На раскрое" видит только свой стек, швея на
    // "В работе" — только свои заказы. Упаковщица на "В работе" видит ЗАКАЗЫ ВСЕХ швей
    // (с именами), поэтому под этот фильтр не попадает.
    if (activeTab === 'На раскрое' && isCutter && o.assignedUserId !== userId) return false;
    if (activeTab === 'В работе' && isSewer && o.assignedUserId !== userId) return false;
    // Закройщик на «В работе» смотрит судьбу СВОЕГО кроя: какие его вещи сейчас шьют.
    // Общий список всех швей ему не нужен — там чужой крой, за который он не отвечает.
    if (activeTab === 'В работе' && isCutter && o.cutterUserId !== userId) return false;
    // На вкладках "Стикеровка" и "Готовые" каждый производственник видит ТОЛЬКО свои заказы
    // по своему этапу: швея — что отшила сама (sewerUserId), закройщик — что раскроил сам
    // (cutterUserId). Упаковщица видит всё (её этап — терминал стикеровки).
    if ((activeTab === 'Готовые' || activeTab === 'Стикеровка') && isSewer && o.sewerUserId !== userId) return false;
    if ((activeTab === 'Готовые' || activeTab === 'Стикеровка') && isCutter && o.cutterUserId !== userId) return false;
    // «Раскроено» — то, что закройщик уже сдал. Показываем только его собственный крой:
    // чужие вещи в этом списке ему не нужны, он по нему проверяет свою выработку.
    if (activeTab === 'Раскроено' && isCutter && o.cutterUserId !== userId) return false;
    return true;
  });

  // «Готовые» — это архив выработки: у швеи там сотня-другая своих заказов, и по
  // десять штук на страницу их пришлось бы листать пятнадцать раз. Остальные вкладки —
  // рабочие очереди на планшете: там вещей единицы, и длинный список только мешает.
  const pageSize = activeTab === 'Готовые' ? 50 : 10;
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const pagedOrders = filteredOrders.slice((page - 1) * pageSize, page * pageSize);

  // Итого по текущему отфильтрованному списку (вся вкладка, не только видимая страница):
  // ширина (width) хранится в см — переводим в погонные метры (п.м.), quantity — штуки.
  const totalMeters = filteredOrders.reduce((sum, o) => sum + ((o.width || 0) * o.quantity) / 100, 0);
  const totalPieces = filteredOrders.reduce((sum, o) => sum + o.quantity, 0);

  const countForTab = (status: SewingStatus) => {
    if (status === 'На раскрое' && isCutter) {
      return orders.filter((o) => o.sewingStatus === status && o.assignedUserId === userId).length;
    }
    if (status === 'В работе' && isSewer) {
      return orders.filter((o) => o.sewingStatus === status && o.assignedUserId === userId).length;
    }
    // У закройщика на вкладке только его крой — счётчик считаем так же.
    if (status === 'В работе' && isCutter) {
      return orders.filter((o) => o.sewingStatus === status && o.cutterUserId === userId).length;
    }
    // "Стикеровка" и "Готовые" — считаем только свои: швея по sewerUserId, закройщик по cutterUserId.
    if ((status === 'Готовые' || status === 'Стикеровка') && isSewer) {
      return orders.filter((o) => o.sewingStatus === status && o.sewerUserId === userId).length;
    }
    if ((status === 'Готовые' || status === 'Стикеровка') && isCutter) {
      return orders.filter((o) => o.sewingStatus === status && o.cutterUserId === userId).length;
    }
    // На вкладке у закройщика только его крой — счётчик должен показывать то же число.
    if (status === 'Раскроено' && isCutter) {
      return orders.filter((o) => o.sewingStatus === status && o.cutterUserId === userId).length;
    }
    return orders.filter((o) => o.sewingStatus === status).length;
  };

  // Нераскроенные заказы закройщика — и число, и сами заказы. По ним печатается лист
  // задания, поэтому важно брать их с сервера, а не из памяти браузера: планшет могли
  // сменить, вкладку открыть заново, кэш очистить — а лист всё равно нужен.
  const myUnfinishedOrders = orders.filter(
    (o) => o.sewingStatus === 'На раскрое' && o.assignedUserId === userId
  );
  const myUnfinishedCount = myUnfinishedOrders.length;

  const myInWorkCount = orders.filter(
    (o) => o.sewingStatus === 'В работе' && o.assignedUserId === userId
  ).length;

  // Связки Яндекса у этой швеи: заказ покупателя шьётся целиком одним человеком, поэтому
  // показываем прогресс — сколько вещей заказа уже ушло со стола (на стикеровку/готово).
  const myGroups = Object.values(
    orders
      .filter((o) => o.groupKey && (o.assignedUserId === userId || o.sewerUserId === userId))
      .reduce<Record<string, { groupKey: string; total: number; done: number }>>((acc, o) => {
        const key = o.groupKey as string;
        if (!acc[key]) acc[key] = { groupKey: key, total: o.groupSize || 0, done: 0 };
        if (o.sewingStatus !== 'В работе') acc[key].done += 1;
        return acc;
      }, {})
  ).filter((g) => g.total > 1 && g.done < g.total);

  return {
    activeTab,
    setActiveTab,
    page,
    setPage,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
    doneFrom,
    setDoneFrom,
    doneTo,
    setDoneTo,
    employeeFilter,
    setEmployeeFilter,
    materialFilter,
    setMaterialFilter,
    widthFilter,
    setWidthFilter,
    heightFilter,
    setHeightFilter,
    workshopFilter,
    setWorkshopFilter,
    marketplaceFilter,
    setMarketplaceFilter,
    isReadOnlyTab,
    filteredOrders,
    totalPages,
    pagedOrders,
    totalMeters,
    totalPieces,
    countForTab,
    myUnfinishedCount,
    myUnfinishedOrders,
    myInWorkCount,
    myGroups,
  };
};