import { usePolling } from '@/hooks/usePolling';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSupplies,
  fetchSupplyDetail,
  type Supply,
} from '@/lib/marketplaceSuppliesApi';
import { fetchGazelkaPlans } from '@/lib/gazelkaApi';
import { fetchMarketplaceIntegrations, type Shop } from '@/lib/marketplaceIntegrationsApi';

const useMarketplaceSuppliesList = () => {
  /** Полный список по текущим фильтрам, кроме схемы: по нему считаются плашки FBS/FBO. */
  const [allSupplies, setAllSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Магазин, с которым работают сейчас. FBS собирают по кабинетам: вещь ДЮНЫ
  // в коробе МЕГАТЮЛЬ на приёмке площадки не примут, поэтому поставки этих
  // магазинов не должны стоять в одном списке вперемешку.
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);

  const [statusFilter, setStatusFilter] = useState('open');
  // Список всегда разделён по схеме: FBS и FBO вперемешку путают склад.
  // По умолчанию — FBS (с ними работают каждый день), выбор запоминаем.
  const [typeFilter, setTypeFilterRaw] = useState<string>(() =>
    localStorage.getItem('supplies_type') === 'FBO' ? 'FBO' : 'FBS',
  );
  const setTypeFilter = (v: string) => {
    const next = v === 'FBO' ? 'FBO' : 'FBS';
    localStorage.setItem('supplies_type', next);
    setTypeFilterRaw(next);
  };
  const [marketplaceFilter, setMarketplaceFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  // ОДИН запрос вместо двух.
  //
  // Раньше страница дважды спрашивала сервер об одном и том же: первый раз без
  // фильтра по схеме — ради цифр в плашках FBS/FBO, второй раз с фильтром — ради
  // таблицы. Отличались они ровно одним условием, а платили мы за два похода.
  //
  // Теперь забираем полный список один раз, а таблицу отбираем по схеме уже на
  // месте: список поставок небольшой, отобрать его в браузере мгновенно.
  const loadSeq = useRef(0);

  const load = (silent = false) => {
    if (!silent) setLoading(true);
    const seq = ++loadSeq.current;
    fetchSupplies({
      status: statusFilter === 'open' ? undefined : statusFilter,
      marketplace: marketplaceFilter !== 'all' ? marketplaceFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search || undefined,
      shopId: shopId || undefined,
    })
      .then((data) => {
        if (seq !== loadSeq.current) return;
        setListError(null);
        const list =
          statusFilter === 'open'
            ? data.filter((s) => s.status !== 'Выполнена' && s.status !== 'Отменена')
            : data;
        // Список с сервера ещё не знает дату слота и забор. Не затираем их на
        // каждом обновлении — иначе при смене таймера пропадают «на маркетплейс»,
        // «Со склада» и машинки, пока карточки не догрузятся заново.
        setAllSupplies((prev) => {
          const prevById = new Map(prev.map((s) => [s.id, s]));
          return list.map((s) => {
            const old = prevById.get(s.id);
            if (!old) return s;
            return {
              ...s,
              supplyDate: 'supplyDate' in s ? s.supplyDate : old.supplyDate,
              timeslot: 'timeslot' in s ? s.timeslot : old.timeslot,
              gazelkaPickup: 'gazelkaPickup' in s ? s.gazelkaPickup : old.gazelkaPickup,
              gazelkaPlanId: 'gazelkaPlanId' in s ? s.gazelkaPlanId : old.gazelkaPlanId,
              gazelkaVehicleNumber:
                'gazelkaVehicleNumber' in s ? s.gazelkaVehicleNumber : old.gazelkaVehicleNumber,
            };
          });
        });
        // Живой список ещё не отдаёт дату слота. Берём её из карточки поставки,
        // пока в ответе списка нет поля supplyDate. После выкладки функции
        // лишние запросы сами прекратятся.
        const needSlot = list.filter(
          (s) => s.type === 'FBO' && (!('supplyDate' in s) || !('gazelkaPickup' in s) || !('gazelkaPlanId' in s)),
        );
        Promise.all([
          Promise.all(needSlot.map((s) => fetchSupplyDetail(s.id).catch(() => null))),
          fetchGazelkaPlans().catch(() => []),
        ]).then(([details, plans]) => {
          if (seq !== loadSeq.current) return;
          const byId = new Map(
            details.flatMap((d) => (d ? [[d.id, d] as const] : [])),
          );
          const plateByPlan = new Map(plans.map((p) => [p.id, p.vehicleNumber || null]));
          setAllSupplies((prev) =>
            prev.map((s) => {
              const detail = byId.get(s.id);
              const planId = detail?.gazelkaPlanId ?? s.gazelkaPlanId;
              const plate = planId != null ? plateByPlan.get(planId) : null;
              return {
                ...s,
                ...(detail
                  ? {
                      supplyDate: detail.supplyDate,
                      timeslot: detail.timeslot,
                      gazelkaPickup: detail.gazelkaPickup,
                      gazelkaPlanId: detail.gazelkaPlanId,
                    }
                  : {}),
                gazelkaVehicleNumber: plate || s.gazelkaVehicleNumber,
              };
            }),
          );
        });
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить поставки');
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  // Магазины грузим один раз: по ним строятся вкладки, и первый становится
  // рабочим — кладовщик всегда собирает поставку конкретного кабинета.
  useEffect(() => {
    fetchMarketplaceIntegrations()
      .then(({ shops: shopList }) => {
        setShops(shopList);
        setShopId((prev) => prev ?? shopList[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!shopId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, statusFilter, marketplaceFilter, dateFrom, dateTo]);

  // Счётчик ПВЗ растёт по мере сканирования — список обновляем, не мигая загрузкой.
  // Раз в 30 секунд и только пока вкладка открыта: раньше каждые 15 секунд со всех
  // компьютеров склада, даже со свёрнутых вкладок, — база упиралась в лимит запросов.
  usePolling(() => (shopId ? load(true) : undefined), 30_000, !!shopId);

  // Плашки FBS/FBO считаем по полному списку: выбрав FBS, кладовщик должен
  // видеть в плашке FBO реальное число, а не ноль — иначе кажется, что поставки
  // пропали. А таблица показывает только выбранную схему.
  const supplies = useMemo(
    () => allSupplies.filter((s) => s.type === typeFilter),
    [allSupplies, typeFilter],
  );

  // Поиск не дёргает сервер на каждую букву: ждём, пока человек допечатает.
  // Раньше искали только по кнопке, и набранный, но не отправленный запрос
  // молча игнорировался — человек думал, что поставок нет.
  //
  // Первый проход пропускаем: при открытии страницы список уже грузится
  // обработчиком фильтров выше, и без этой проверки запрос ушёл бы дважды.
  const searchMounted = useRef(false);
  useEffect(() => {
    if (!searchMounted.current) {
      searchMounted.current = true;
      return;
    }
    const t = setTimeout(load, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const currentShop = shops.find((s) => s.id === shopId) || null;

  const resetFilters = () => {
    setStatusFilter('open');
    setMarketplaceFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  return {
    allSupplies,
    supplies,
    loading,
    listError,
    load,
    shops,
    shopId,
    setShopId,
    currentShop,
    statusFilter,
    setStatusFilter,
    typeFilter,
    setTypeFilter,
    marketplaceFilter,
    setMarketplaceFilter,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    search,
    setSearch,
    resetFilters,
  };
};

export default useMarketplaceSuppliesList;
