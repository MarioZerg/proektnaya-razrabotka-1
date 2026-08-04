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
}: UseSewingItemsFiltersArgs) => {
  const [activeTab, setActiveTab] = useState<SewingStatus>(visibleTabs[0]?.value || 'Новый');
  const [page, setPage] = useState(1);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [widthFilter, setWidthFilter] = useState('all');
  const [heightFilter, setHeightFilter] = useState('all');
  const [workshopFilter, setWorkshopFilter] = useState('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState('all');

  // Упаковщица весь конвейер видит только для просмотра — реальные действия она выполняет
  // на отдельном терминале стикеровки (Kiosk), а не на этой странице. Швея не может ничего
  // делать с заказами на вкладке "Стикеровка" — она их только отправила и ждёт закрытия.
  const isReadOnlyTab =
    isPacker || (activeTab === 'Раскроено' && (isSewer || isCutter)) || (activeTab === 'Стикеровка' && isSewer);

  const ordersInTab = orders.filter((o) => o.sewingStatus === activeTab);

  const filteredOrders = ordersInTab.filter((o) => {
    if (searchQuery.trim() && !o.orderNumber.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
    if (typeFilter !== 'all' && o.orderType !== typeFilter) return false;
    if (employeeFilter !== 'all' && String(o.assignedUserId) !== employeeFilter) return false;
    if (materialFilter !== 'all' && o.material !== materials.find((m) => String(m.id) === materialFilter)?.name) return false;
    if (widthFilter !== 'all' && String(o.width) !== widthFilter) return false;
    if (heightFilter !== 'all' && String(o.height) !== heightFilter) return false;
    if (workshopFilter !== 'all' && String(o.workshopId) !== workshopFilter) return false;
    if (marketplaceFilter !== 'all' && o.marketplace !== marketplaceFilter) return false;
    // Владение по вкладкам: закройщик на "На раскрое" видит только свой стек, швея на
    // "В работе" — только свои заказы. Упаковщица на "В работе" видит ЗАКАЗЫ ВСЕХ швей
    // (с именами), поэтому под этот фильтр не попадает.
    if (activeTab === 'На раскрое' && isCutter && o.assignedUserId !== userId) return false;
    if (activeTab === 'В работе' && isSewer && o.assignedUserId !== userId) return false;
    // На вкладке "Готовые" каждый производственник видит ТОЛЬКО свои заказы по своему этапу:
    // швея — что отшила сама (sewerUserId), закройщик — что раскроил сам (cutterUserId).
    // Упаковщица видит все готовые (её этап — терминал стикеровки).
    if (activeTab === 'Готовые' && isSewer && o.sewerUserId !== userId) return false;
    if (activeTab === 'Готовые' && isCutter && o.cutterUserId !== userId) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / 10));
  const pagedOrders = filteredOrders.slice((page - 1) * 10, page * 10);

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
    // "Готовые" — считаем только свои: швея по sewerUserId, закройщик по cutterUserId.
    if (status === 'Готовые' && isSewer) {
      return orders.filter((o) => o.sewingStatus === status && o.sewerUserId === userId).length;
    }
    if (status === 'Готовые' && isCutter) {
      return orders.filter((o) => o.sewingStatus === status && o.cutterUserId === userId).length;
    }
    return orders.filter((o) => o.sewingStatus === status).length;
  };

  const myUnfinishedCount = orders.filter(
    (o) => o.sewingStatus === 'На раскрое' && o.assignedUserId === userId
  ).length;

  const myInWorkCount = orders.filter(
    (o) => o.sewingStatus === 'В работе' && o.assignedUserId === userId
  ).length;

  return {
    activeTab,
    setActiveTab,
    page,
    setPage,
    searchQuery,
    setSearchQuery,
    typeFilter,
    setTypeFilter,
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
    myInWorkCount,
  };
};