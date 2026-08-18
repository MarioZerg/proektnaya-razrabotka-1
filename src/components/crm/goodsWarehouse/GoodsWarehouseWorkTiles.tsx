import { useNavigate } from 'react-router-dom';
import WorkTile from '@/components/crm/goodsWarehouse/WorkTile';

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
  onPlace: () => void;
  onPickup: () => void;
  onPlaceInspected: () => void;
}

/**
 * Работа на сейчас — плитки с числами и легенда цветов.
 *
 * Кладовщик видит, сколько вещей ждёт на каждом шаге, и нажимает ту, где есть работа:
 * пустые остаются серыми и в глаза не лезут.
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
  onPlace,
  onPickup,
  onPlaceInspected,
}: GoodsWarehouseWorkTilesProps) => {
  const navigate = useNavigate();

  return (
    <>
      {/* Плитка «Собрать с полок» убрана: то же самое делается на странице «Товар
          к подбору» — там список вещей с полками и сканер, который сразу печатает
          стикер. Два входа в одну работу только заставляли кладовщика выбирать,
          каким из них пользоваться. */}
      {/* items-end: у плитки возвратов сверху надстроен шаг «Привёз с ПВЗ», и без
          выравнивания по низу три плитки стояли бы на разной высоте. */}
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

      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <WorkTile
          icon="Boxes"
          title="Разложить по полкам"
          hint="Отказы клиентов из цеха"
          count={pendingShelfCount}
          zone="both"
          onClick={onPlace}
        />
        {/* Приём осмотренных из цеха — своя плитка, а не вкладка внутри раскладки.
            Это отдельный поток: упаковщица осмотрела возврат и наклеила стикер,
            кладовщик забирает такие вещи из цеха и ставит на хранение. */}
        <WorkTile
          icon="Warehouse"
          title="Принять осмотренные из цеха"
          hint="Возвраты после осмотра — на хранение"
          count={inspectedReady}
          zone="both"
          onClick={onPlaceInspected}
        />
        {/* Возвраты от покупателей — два шага подряд, поэтому они связаны стрелкой:
            сначала кладовщик отмечает, что привёз с пункта выдачи, и вещи встают на
            склад; потом разбирает их — в цех на осмотр или на полку. Автоматически
            раскладывать нельзя: среди возвратов бывают мятые и с дефектом. */}
        <WorkTile
          icon="Undo2"
          title="Разобрать возвраты"
          hint="Решить: в цех на осмотр или на полку"
          count={pendingReturnsCount}
          zone="both"
          onClick={() => navigate('/crm/inventory/returns-inspection')}
          stepLabel="Привёз с пункта выдачи"
          stepIcon="Truck"
          onStep={onPickup}
        />
        {/* Инвентаризация живёт здесь, а не в меню: пересчёт — работа на складе,
            у стеллажей, и начинается он с этой же страницы. Пока пересчёт идёт,
            плитка показывает, сколько вещей ещё не сосчитано, — чтобы работу не
            бросили на середине. */}
        <WorkTile
          icon="ClipboardCheck"
          title={stocktakeActive ? 'Продолжить инвентаризацию' : 'Инвентаризация'}
          hint={
            stocktakeActive
              ? 'Пересчёт идёт — осталось сосчитать'
              : 'Пересчитать товар по полкам'
          }
          count={stocktakeActive ? stocktakeLeft : 0}
          zone="warehouse"
          onClick={() => navigate('/crm/inventory/stocktakes')}
        />
        <WorkTile
          icon="Truck"
          title="Товар к подбору"
          // Разбивка прямо в подсказке: FBS собирают поштучно с ярлыком на каждую
          // вещь, FBO складывают коробкой на склад площадки. Кладовщик по этим двум
          // числам решает, с чего начать день, не открывая страницу.
          hint={
            pickingFbo + pickingFbs > 0
              ? `FBS: ${pickingFbs} · FBO: ${pickingFbo}`
              : 'Собрать с полок и наклеить стикеры'
          }
          count={pickingPending}
          zone="warehouse"
          onClick={() => navigate('/crm/inventory/goods-picking')}
        />
      </div>
    </>
  );
};

export default GoodsWarehouseWorkTiles;