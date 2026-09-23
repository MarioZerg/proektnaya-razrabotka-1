import { useEffect, useMemo, useRef, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import {
  fetchPickingOrders,
  verifyPicking,
  rematchStock,
  type PickingOrder,
} from '@/lib/goodsWarehouseApi';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';

/**
 * Данные страницы «Товар к подбору»: загрузка, сверка с маркетплейсом и счётчики.
 *
 * Вынесено из страницы без изменений логики — порядок вызовов и зависимости
 * эффектов те же, иначе сверка и опрос списка начнут срабатывать в другой момент.
 */
export const useGoodsPicking = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [orders, setOrders] = useState<PickingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [rematching, setRematching] = useState(false);

  // Списать ненайденную вещь может только старший кладовщик и админ: за этим стоят
  // потраченная ткань и повторная работа цеха. Обычный кладовщик зовёт старшего.
  // Сервер проверяет право ещё раз — спрятанной кнопки для защиты мало.
  const searchRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    fetchPickingOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  // Заказы приходят в течение дня — обновляем сами, чтобы кладовщик не жал F5.
  // Раз в минуту и только пока на экран смотрят: свёрнутая вкладка не тратит ничего.
  usePolling(load, 60000);

  /**
   * Пересчёт подбора по всему складу.
   *
   * Обычно вещь встаёт в подбор сама — в момент, когда её кладут на полку. Но заказы
   * приходят и другим путём: загрузка заявки FBO создаёт сразу сотни позиций, а
   * готовый товар под них уже лежит на складе. Такие заказы в подбор не попадают и
   * молча уходят в пошив, хотя шить ничего не нужно.
   *
   * Кнопка сверяет весь свободный остаток с новыми заказами и закрывает то, что
   * закрывается складом.
   */
  const handleRematch = async () => {
    setRematching(true);
    try {
      const res = await rematchStock();
      toast({
        title: res.matched
          ? `Подобрано со склада: ${res.matched}`
          : 'Новых совпадений нет',
        description: res.matched
          ? 'Эти заказы закрываются готовым товаром — шить их не нужно'
          : 'Весь свободный остаток уже разобран по заказам',
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось пересчитать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRematching(false);
    }
  };

  // Перед работой сверяем список с маркетплейсом: часть заказов, пока вещи лежали на
  // полке, уже уехала к покупателю или отменилась. Ярлык для них не выдадут, собрать
  // такие вещи невозможно — они возвращаются на полку, а не отправляют кладовщика
  // к стеллажу за мёртвой работой.
  useEffect(() => {
    verifyPicking(undefined, user?.id, user?.name)
      .then((res) => {
        if (res.total > 0) {
          toast({
            title: `Снято с подбора: ${res.total}`,
            description: 'Заказы отменены или уже уехали — вещи вернулись на полку хранения',
          });
        }
        // Вещи, которые числились на хранении, хотя за ними закреплён живой заказ:
        // в списке их не было, а сканер на них ругался. Возвращаем в работу.
        if (res.restored) {
          toast({
            title: `Возвращено в подбор: ${res.restored}`,
            description: 'Эти вещи были заняты заказами, но не показывались в списке',
          });
        }
        if (res.total > 0 || res.restored) load();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Фокус в поиске: кладовщик заходит на страницу и сразу пикает сканером, не мышкой.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Ищем по названию товара и номеру заказа: сканер «пикает» номер — строка находится сразу.
  // ОДИН СПИСОК, БЕЗ ВКЛАДОК.
  //
  // Раньше здесь были две вкладки — «Собрать с полок» и «Донести в короб»: вещь
  // с напечатанным стикером уезжала из первого списка во второй. Кладовщики от этого
  // путались: вещь пропадала из списка, по которому они шли вдоль стеллажа, и
  // приходилось искать её на другой вкладке.
  //
  // На деле разделение не нужно — они и так понимают: стикер наклеен, значит вещь
  // надо отсканировать в поставку. Поэтому вещь остаётся в общем списке до тех пор,
  // пока её не отправят на поставку кнопкой в карточке. Печать стикера сама по себе
  // из списка ничего не убирает.
  const labeledCount = useMemo(
    () => orders.filter((o) => o.status === 'awaiting_supply' && !o.extraForSupply).length,
    [orders]
  );

  /**
   * Лишние вещи FBO: заявка по этому размеру уже закрыта коробами.
   *
   * Товар FBO обезличен, и в короб уезжает та вещь, что под рукой, — а
   * «запасная» того же размера остаётся закреплённой за строкой заявки. Идти
   * за ней к стеллажу не нужно: в короб она не пойдёт. Держим такие строки
   * отдельно от настоящей работы, иначе кладовщик собирает заявку с перебором.
   */
  const extraItems = useMemo(() => orders.filter((o) => o.extraForSupply), [orders]);
  const workOrders = useMemo(() => orders.filter((o) => !o.extraForSupply), [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workOrders;
    return workOrders.filter(
      (o) =>
        o.product?.toLowerCase().includes(q) ||
        o.orderNumber?.toLowerCase().includes(q) ||
        o.storageBarcode?.toLowerCase().includes(q) ||
        o.shelfName?.toLowerCase().includes(q) ||
        o.material?.toLowerCase().includes(q) ||
        // По «ozon», «wb», «fbs», «fbo» — кладовщик отбирает работу одного вида,
        // чтобы собрать её за один проход по складу.
        o.marketplace?.toLowerCase().includes(q) ||
        o.orderType?.toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, search]);

  /** Разбивка отобранного по площадке и схеме: «OZON FBS: 9», «OZON FBO: 19». */
  const byScheme = useMemo(() => {
    const acc: Record<string, number> = {};
    filtered.forEach((o) => {
      const label = `${(o.marketplace || '—').toUpperCase()} ${o.orderType || ''}`.trim();
      acc[label] = (acc[label] || 0) + 1;
    });
    return acc;
  }, [filtered]);

  /** Главные числа дня: сколько собирать по FBS и сколько по FBO.
   * Работа разная — FBS клеится поштучно, FBO уезжает коробкой. */
  const fbsCount = useMemo(
    () => filtered.filter((o) => (o.orderType || '').toUpperCase() === 'FBS').length,
    [filtered]
  );
  const fboCount = useMemo(
    () => filtered.filter((o) => (o.orderType || '').toUpperCase() === 'FBO').length,
    [filtered]
  );

  return {
    loading,
    search,
    setSearch,
    scanOpen,
    setScanOpen,
    rematching,
    searchRef,
    load,
    handleRematch,
    labeledCount,
    extraItems,
    workOrders,
    filtered,
    byScheme,
    fbsCount,
    fboCount,
  };
};

export default useGoodsPicking;
