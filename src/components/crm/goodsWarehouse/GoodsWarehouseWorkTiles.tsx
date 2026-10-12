import { useNavigate } from 'react-router-dom';
import WarehouseLiveStations, {
  type WarehouseStation,
} from '@/components/crm/goodsWarehouse/WarehouseLiveStations';

interface GoodsWarehouseWorkTilesProps {
  /** Отказы клиентов из цеха: вещь со стикером, но без полки. */
  pendingShelfCount: number;
  /** Возвраты с ПВЗ, ждущие решения кладовщика. */
  pendingReturnsCount: number;
  /** Осмотренные упаковщицей вещи, готовые к выдаче на склад. */
  inspectedReady: number;
  /** Вещи, подобранные под заказы и ждущие стикеровки. */
  pickingPending: number;
  /** Та же работа в разбивке по схемам: FBS клеится поштучно, FBO едет коробкой. */
  pickingFbo?: number;
  pickingFbs?: number;
  /** Идёт ли пересчёт склада прямо сейчас. */
  stocktakeActive?: boolean;
  /** Сколько вещей ещё не сосчитано в текущем пересчёте. */
  stocktakeLeft?: number;
  /** FRONTEND-ONLY: очередь ещё грузится — не показывать 0 как «пусто». */
  queuesLoading?: boolean;
  onPlace: () => void;
  onPickup: () => void;
  onPlaceInspected: () => void;
}

/**
 * Работа на сейчас — живые станции с цифрами.
 *
 * Кладовщик видит, сколько вещей ждёт на каждом шаге, и нажимает ту, где есть работа.
 * Станция при наведении приподнимается и сдвигается: так видно, что это кнопка,
 * а не картинка. На телефоне станции стоят блоками друг под другом.
 */
const GoodsWarehouseWorkTiles = ({
  pendingShelfCount,
  pendingReturnsCount,
  inspectedReady,
  pickingPending,
  pickingFbo = 0,
  pickingFbs = 0,
  stocktakeActive = false,
  stocktakeLeft = 0,
  queuesLoading = false,
  onPlace,
  onPickup,
  onPlaceInspected,
}: GoodsWarehouseWorkTilesProps) => {
  const navigate = useNavigate();

  const stations: WarehouseStation[] = [
    {
      title: 'Принять осмотренные из цеха',
      hint: 'Упаковщица уже посмотрела — можно забирать',
      count: inspectedReady,
      loading: queuesLoading,
      tone: 'violet',
      scene: 'receive',
      onClick: onPlaceInspected,
    },
    {
      title: 'Разложить по полкам',
      hint: 'Отказы из цеха и вещи, которые уже на складе, но без полки',
      count: pendingShelfCount,
      loading: queuesLoading,
      tone: 'violet',
      scene: 'shelves',
      onClick: onPlace,
    },
    {
      title: 'Привёз с пункта выдачи',
      count: null,
      tone: 'violet',
      scene: 'van',
      onClick: onPickup,
    },
    {
      title: 'Разобрать возвраты',
      hint: 'Решить: в цех на осмотр или на полку',
      count: pendingReturnsCount,
      loading: queuesLoading,
      tone: 'violet',
      scene: 'returns',
      onClick: () => navigate('/crm/inventory/returns-inspection?stage=fromMarketplace'),
    },
    {
      title: stocktakeActive ? 'Продолжить инвентаризацию' : 'Инвентаризация',
      hint: stocktakeActive ? 'Пересчёт уже идёт' : 'Сверить полки с системой',
      count: stocktakeActive ? stocktakeLeft : null,
      tone: 'violet',
      scene: 'stocktake',
      onClick: () => navigate('/crm/inventory/stocktakes'),
    },
    {
      title: 'Товар к подбору',
      hint:
        pickingFbo + pickingFbs > 0
          ? `FBS: ${pickingFbs} · FBO: ${pickingFbo}`
          : 'Собрать с полок и наклеить стикеры',
      count: pickingPending,
      tone: 'cyan',
      scene: 'picking',
      onClick: () => navigate('/crm/inventory/goods-picking'),
    },
  ];

  return (
    <>
      {/* Легенда цветов: без неё маркеры пришлось бы объяснять устно каждому новому
          сотруднику. Одна строка снимает все вопросы. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
          Производство
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          Склад
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-violet-500 to-emerald-500" />
          Передача из цеха на склад
        </span>
      </div>

      <WarehouseLiveStations stations={stations} />
    </>
  );
};

export default GoodsWarehouseWorkTiles;