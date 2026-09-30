import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchInterceptedOrders,
  type KioskInterceptedOrder,
} from '@/lib/kioskApi';
import { playWarehouseAlert, primeWarehouseAlerts } from '@/lib/warehouseAlerts';

/**
 * НАПОМИНАНИЕ О ПЕРЕХВАЧЕННОМ КРОЕ НА ТЕРМИНАЛЕ ЦЕХА.
 *
 * ЧТО ТАКОЕ ПЕРЕХВАТ. Покупатель отменил заказ уже после раскроя: ткань разрезана
 * по его размеру и в рулон не вернётся. Следом пришёл новый заказ того же размера —
 * крой отдали ему, и шить с нуля не пришлось.
 *
 * ПОЧЕМУ ОБ ЭТОМ НАДО КРИЧАТЬ. Бирка на вешалке осталась от ОТМЕНЁННОГО заказа:
 * перепечатать её в момент перехвата некому, заказы приходят и ночью. Пока на вещь
 * не напечатан НОВЫЙ лист закройщика, она едет по цеху с чужим номером — швея не
 * понимает, что у неё в руках, а разбор потери на вешалке превращается в гадание.
 *
 * ПОЧЕМУ ЗВУК, А НЕ НАДПИСЬ. Швея за смену почти не подходит к терминалу: она у
 * машинки. Молчаливая плашка на экране, к которому никто не подходит, не работает.
 *
 * ПОЧЕМУ КАЖДЫЕ ПЯТЬ МИНУТ. Один сигнал легко пропустить за шумом машинок. Терминал
 * повторяет напоминание, пока лист не напечатан ИЛИ вещь не ушла на стикеровку —
 * дальше напоминать поздно, вещь уже отшита.
 *
 * ЗВУЧИТ НА ЛЮБОМ ЭКРАНЕ ТЕРМИНАЛА, а не только в меню: сотрудник может стоять
 * в рулонах или на стикеровке, и напоминание не должно зависеть от того, куда он
 * нажал последним.
 */

/** Как часто терминал напоминает о перехвате. */
const REPEAT_MS = 5 * 60 * 1000;

/** Как часто спрашиваем сервер. Чаще напоминания: плашка на экране должна гаснуть
 * сразу после печати, а не досиживать до конца пятиминутки. */
const POLL_MS = 60 * 1000;

interface Options {
  /** Цех терминала: перехваты соседнего цеха здесь не нужны — крой висит не тут. */
  workshopId: number | null;
  /** Смена открыта. Без неё в цехе никто не работает, и напоминать некому. */
  active: boolean;
}

export const useKioskIntercepted = ({ workshopId, active }: Options) => {
  const [orders, setOrders] = useState<KioskInterceptedOrder[]>([]);
  /** Когда голос звучал в последний раз — по нему держим пятиминутный шаг. */
  const lastSpokeAt = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await fetchInterceptedOrders(workshopId);
      setOrders(list);
      return list;
    } catch {
      // Сеть моргнула — прошлый список оставляем как есть. Гасить плашку по ошибке
      // связи нельзя: работа-то никуда не делась.
      return null;
    }
  }, [workshopId]);

  useEffect(() => {
    if (!active) {
      setOrders([]);
      return;
    }

    let alive = true;

    // Браузер молчит, пока человек ничего не нажал. К этому моменту сотрудник уже
    // отсканировал бейдж и открыл смену — прогреваем файл, чтобы первое же
    // напоминание прозвучало, а не проглотилось.
    primeWarehouseAlerts();

    const tick = async () => {
      const list = await load();
      if (!alive || !list || list.length === 0) return;
      const now = Date.now();
      if (now - lastSpokeAt.current < REPEAT_MS) return;
      lastSpokeAt.current = now;
      playWarehouseAlert('cutIntercepted');
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active, load]);

  return { orders, reload: load };
};
