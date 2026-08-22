import { useEffect, useState } from 'react';
import { fetchSupplyDetail, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';

/**
 * Данные карточки поставки: сама поставка, готовые к сборке вещи, справочник товаров
 * и редактируемые поля формы.
 *
 * Вынесено из страницы без изменения логики — тот же порядок запросов, те же фильтры
 * и та же обработка ошибок.
 */
export const useSupplyData = (supplyId: number) => {
  const [supply, setSupply] = useState<SupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [supplyNumber, setSupplyNumber] = useState('');
  const [supplyBarcode, setSupplyBarcode] = useState('');
  const [cluster, setCluster] = useState('');
  const [gazelkaId, setGazelkaId] = useState('');
  const [comment, setComment] = useState('');

  const [readyGoods, setReadyGoods] = useState<GoodsWarehouseItem[]>([]);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>([]);

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Перезагрузка карточки.
   *
   * silent=true — обновляем данные, НЕ показывая экран «Загрузка...» вместо страницы.
   * Полноэкранный спиннер уместен только при первом открытии: если показывать его на
   * каждом фоновом обновлении, у кладовщика посреди сборки исчезает вся таблица и
   * теряется место в прокрутке.
   */
  const load = (silent = false) => {
    if (!silent) setLoading(true);
    // «Готово к сборке» — это вещи, застикерованные и ждущие отгрузки: сшитые в цехе
    // (awaiting_supply, лежат в контейнере) и снятые с полок (picking).
    // Оба статуса берём ОДНИМ запросом: раньше на это уходило два вызова функции
    // подряд, хотя запрос к базе почти одинаковый.
    Promise.all([
      fetchSupplyDetail(supplyId),
      fetchGoodsWarehouse('picking,awaiting_supply'),
    ])
      .then(([data, goods]) => {
        setSupply(data);
        // Считаем готовым только то, что поедет ИМЕННО в эту поставку: своя площадка,
        // своя схема (FBS/FBO), а для FBO — ещё и свой кластер. Раньше счётчик брал весь
        // склад разом, и в поставке WB показывалось несколько десятков вещей для OZON.
        setReadyGoods(
          goods.filter(
            (g) =>
              g.marketplace === data.marketplace &&
              g.orderType === data.type &&
              (data.type !== 'FBO' || !data.cluster || g.cluster === data.cluster) &&
              // Без наклеенного ярлыка маркетплейса вещь в поставку не принимается —
              // сканер её развернёт. Считать такие «готовыми» нельзя: кладовщик видел
              // 82 шт, а отсканировать мог только 35, и искал по складу несуществующее.
              !!g.shippingLabeledAt &&
              // Уже лежит в какой-то поставке — либо в этой, либо в чужой. В обоих
              // случаях это не «готовое к сборке», сканировать её больше не нужно.
              (g.supplyId === null || g.supplyId === data.id),
          ),
        );
        setSupplyNumber(data.supplyNumber || '');
        setSupplyBarcode(data.supplyBarcode || '');
        setCluster(data.cluster || '');
        setGazelkaId(data.gazelkaId || '');
        setComment(data.comment || '');
      })
      // Счётчик готового считается из карточки поставки и склада вместе, поэтому запросы
      // не разделить. Ловим ошибку, чтобы обрыв связи не оставлял вечный кружок загрузки.
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // Первое открытие карточки — здесь спиннер уместен: показывать пока нечего.
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyId]);

  // Справочник товаров нужен для догрузки в пошив — грузим один раз при открытии карточки.
  useEffect(() => {
    fetchMarketplaceItems().then(setMarketplaceItems).catch(() => setMarketplaceItems([]));
  }, []);

  return {
    supply,
    setSupply,
    loading,
    readyGoods,
    setReadyGoods,
    marketplaceItems,
    now,
    load,
    fields: {
      supplyNumber,
      setSupplyNumber,
      supplyBarcode,
      setSupplyBarcode,
      cluster,
      setCluster,
      gazelkaId,
      setGazelkaId,
      comment,
      setComment,
    },
  };
};

export default useSupplyData;
