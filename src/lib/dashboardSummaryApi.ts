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

  // ПОВТОР ПРИ ОТКАЗЕ.
  //
  // В начале смены главную открывают все разом — полтора десятка планшетов в одну
  // секунду. Сервер держит ограниченное число одновременных обращений и лишним
  // отвечает отказом: у человека вместо цифр пустая панель, хотя всё исправно и
  // достаточно повторить через мгновение.
  //
  // Ждём с увеличением паузы и вразнобой (случайная добавка): если все планшеты
  // повторят одновременно, они снова столкнутся лбами. Разводим их по времени.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const backoff = 300 * 2 ** (attempt - 1) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
      // 5xx — сервер перегружен, имеет смысл повторить. Остальное (например,
      // неверный запрос) от повтора не исправится — выходим сразу.
      if (res.status < 500) throw new Error('Не удалось загрузить сводку');
      lastError = new Error('Не удалось загрузить сводку');
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Не удалось загрузить сводку');
};
