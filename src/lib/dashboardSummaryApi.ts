import fetchWithRetry from '@/lib/fetchWithRetry';
import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>)['dashboard_summary'];

/**
 * Готовые цифры для плиток главной страницы.
 *
 * Складские поля приходят только тем, кто отвечает за склад: остальным ролям
 * эти плитки не показываются, и считать их незачем.
 */
export interface DashboardSummary {
  newOrders: number;
  inSewing: number;
  inCutting: number;
  inStickering: number;
  cut: number;
  urgentFbs: number;
  notShippedToWorkshop: number;
  notReceivedInWorkshop: number;
  duplicateOrders: number;
  lowStockRolls?: number;
  awaitingShelf?: number;
  awaitingShipLabel?: number;
  returnsPickedUp?: number;
}

/**
 * Забирает готовые цифры для панели одним запросом.
 *
 * Раньше панель выкачивала все заказы, весь склад и все рулоны (около 4.5 МБ) и
 * считала плитки прямо в браузере. Теперь считает база, а сюда приходит только
 * десяток чисел — формулы те же, цифры прежние.
 */
export const fetchDashboardSummary = async (
  role?: string,
  userId?: number,
): Promise<DashboardSummary> => {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (userId) params.set('userId', String(userId));
  const qs = params.toString();
  const url = qs ? `${URL}?${qs}` : URL;

  // Повтор при отказе живёт в общем помощнике: начало смены пробивает потолок
  // одновременных запусков, и лишним сервер отвечает отказом.
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error('Не удалось загрузить сводку');
  return res.json();
};
