import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchGoodsWarehouse,
  returnGoodsToWorkshop,
  markGoodsLost,
  deleteGoods,
  type GoodsWarehouseItem,
} from '@/lib/goodsWarehouseApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { fetchMarketplaceReturns } from '@/lib/marketplaceReturnsApi';
import { usePickingPending } from '@/hooks/usePickingPending';
import ReceiveReturnDialog from '@/components/crm/goodsWarehouse/ReceiveReturnDialog';
import MoveShelfDialog from '@/components/crm/goodsWarehouse/MoveShelfDialog';
import PlaceOnShelfDialog from '@/components/crm/goodsWarehouse/PlaceOnShelfDialog';
import ShipLabelDialog from '@/components/crm/goodsWarehouse/ShipLabelDialog';
import ReprintReportDialog from '@/components/crm/goodsWarehouse/ReprintReportDialog';
import AdminReceiveDialog from '@/components/crm/goodsWarehouse/AdminReceiveDialog';
import { printShelfPickList } from '@/lib/printShelfPickList';
import GoodsWarehouseFilters from '@/components/crm/goodsWarehouse/GoodsWarehouseFilters';
import GoodsWarehouseTable from '@/components/crm/goodsWarehouse/GoodsWarehouseTable';
import WorkTile from '@/components/crm/goodsWarehouse/WorkTile';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const GoodsWarehouse = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  /** Ручную приёмку делает и кладовщик: излишек с производства приносят прямо ему на склад,
   * ждать администратора, чтобы завести вещь и напечатать стикер, — терять время. */
  const canReceiveManually = isAdmin || isStorekeeperRole(user?.role);

  const [items, setItems] = useState<GoodsWarehouseItem[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('in_stock');
  const [materialFilter, setMaterialFilter] = useState('');
  const [widthFilter, setWidthFilter] = useState('');
  const [heightFilter, setHeightFilter] = useState('');
  const [shelfFilter, setShelfFilter] = useState('');


  // Принять новые возвраты
  const [returnOpen, setReturnOpen] = useState(false);


  // Разложить отменённые товары по полкам (сканером) и стикеровка заказов с полок
  const [placeOpen, setPlaceOpen] = useState(false);
  const [shipLabelOpen, setShipLabelOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [adminReceiveOpen, setAdminReceiveOpen] = useState(false);

  // Смена полки
  const [moveOpen, setMoveOpen] = useState(false);

  const load = () => {
    setLoading(true);
    // Товар попадает на склад только по сканированию стикера хранения — вручную выбрать
    // заказ и «положить» его на полку нельзя, поэтому список заказов здесь больше не нужен.
    // Полки грузим отдельно от товара: если связь моргнула и справочник не дошёл,
    // склад всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchShelves().then(setShelves).catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchGoodsWarehouse()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Возвраты, забранные с пункта выдачи, но ещё не осмотренные: товар привезли,
  // а решение (полка / перепаковка / утиль) кладовщик ещё не принял. Пока вещь не
  // лежит на полке, она считается непроверенной и в подбор не попадает.
  const [uncheckedReturns, setUncheckedReturns] = useState(0);

  // Подбор теперь открывается только отсюда — держим на кнопке живой счётчик,
  // чтобы кладовщик видел работу, не заходя внутрь. Звук не нужен: он уже есть
  // в общем меню, дублировать сигнал на этой странице ни к чему.
  const { pending: pickingPending } = usePickingPending(true, false);

  useEffect(() => {
    fetchMarketplaceReturns({ status: 'picked_up' })
      .then((d) => setUncheckedReturns(d.counts.picked_up || 0))
      .catch(() => setUncheckedReturns(0));
  }, []);

  // Вещи, отменённые клиентом: упаковщик наклеил стикер хранения, кладовщик ещё не положил
  // их на полку — именно их он забирает из цеха.
  const pendingShelf = useMemo(
    // Возвраты с маркетплейса (mp_return) кладовщик раскладывает тем же действием:
    // вещь у него в руках, ей нужна полка.
    () => items.filter((i) => i.status === 'awaiting_shelf' || i.status === 'mp_return'),
    [items],
  );

  // Вещи с полок, подобранные под новые заказы FBS и ждущие стикера отправления.
  const matchedFromStock = useMemo(
    () => items.filter((i) => i.reservedOrderId && !i.shippingLabeledAt && i.status === 'picking'),
    [items],
  );

  const materialsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.material).filter((m): m is string => !!m))).sort(),
    [items]
  );

  // Списки ширин и высот собираем из того, что реально лежит на складе.
  const widthsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.width).filter((w): w is number => !!w))).sort((a, b) => a - b),
    [items]
  );
  const heightsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.height).filter((h): h is number => !!h))).sort((a, b) => a - b),
    [items]
  );

  const q = search.trim().toLowerCase();

  const filtered = items.filter((i) => {
    // Поиск идёт по всему, чем вещь можно назвать: стикер хранения (его пикают сканером),
    // номер заказа — свой и тот, под который вещь подобрана, название и материал.
    // Пока в строке что-то есть, статус не ограничиваем: кладовщик ищет конкретную вещь
    // и не должен гадать, в каком она сейчас состоянии.
    if (q) {
      const haystack = [
        i.storageBarcode,
        i.orderNumber,
        i.reservedOrderNumber,
        i.product,
        i.material,
        i.shelfName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    } else if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (materialFilter && i.material !== materialFilter) return false;
    if (widthFilter && i.width !== Number(widthFilter)) return false;
    if (heightFilter && i.height !== Number(heightFilter)) return false;
    // 'none' — вещи без полки: приняты, но ещё не разложены.
    if (shelfFilter === 'none' ? i.shelfId != null : shelfFilter && String(i.shelfId) !== shelfFilter)
      return false;
    return true;
  });

  // Считаем остатки по полкам только среди товаров, которые реально лежат на складе:
  // отгруженные и утерянные вещи собирать не нужно.
  const shelfCounts = useMemo(() => {
    const acc: Record<number, number> = {};
    items.forEach((i) => {
      if (i.status !== 'in_stock' && i.status !== 'picking') return;
      if (i.shelfId == null) return;
      acc[i.shelfId] = (acc[i.shelfId] || 0) + 1;
    });
    return acc;
  }, [items]);

  const noShelfCount = useMemo(
    () =>
      items.filter(
        (i) =>
          i.shelfId == null &&
          (i.status === 'in_stock' || i.status === 'awaiting_shelf' || i.status === 'mp_return'),
      ).length,
    [items],
  );

  const activeFiltersCount = [
    !!q,
    statusFilter !== 'in_stock',
    !!materialFilter,
    !!widthFilter,
    !!heightFilter,
    !!shelfFilter,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setMaterialFilter('');
    setWidthFilter('');
    setHeightFilter('');
    setShelfFilter('');
  };

  const handlePrintPickList = () => {
    const shelfName =
      shelfFilter === 'none'
        ? 'Без полки'
        : shelves.find((s) => String(s.id) === shelfFilter)?.name || 'Все полки';
    printShelfPickList(filtered, shelfName);
  };

  const openReturn = () => {
    setReturnOpen(true);
  };



  const openMove = () => {
    setMoveOpen(true);
  };


  const handleReturn = async (id: number) => {
    try {
      await returnGoodsToWorkshop(id);
      toast({ title: 'Товар возвращён в цех' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleMarkLost = async (id: number, reason: string) => {
    try {
      await markGoodsLost(id, reason);
      toast({ title: 'Товар отмечен утерянным' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // Удаление со склада: доступно только администратору и только для вещей на хранении.
  // Сервер проверяет это повторно — права нельзя обойти через интерфейс.
  const handleDeleteGoods = async (id: number) => {
    try {
      await deleteGoods(id, user?.id, user?.name);
      toast({ title: 'Товар удалён со склада' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось удалить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Склад товара</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Готовые изделия по полкам — источник для поставок на маркетплейс
            </p>
          </div>
          {/* Редкие действия убраны под «Ещё»: раньше десять кнопок в один ряд
              переносились на две-три строки, и глазами приходилось искать нужную. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={openReturn}>
              <Icon name="PackageCheck" size={16} className="mr-2" />
              Принять возвраты
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Icon name="Ellipsis" size={16} className="mr-2" />
                  Ещё
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={openMove}>
                  <Icon name="ArrowLeftRight" size={16} className="mr-2" />
                  Сменить полку
                </DropdownMenuItem>
                {canReceiveManually && (
                  <DropdownMenuItem onClick={() => setAdminReceiveOpen(true)}>
                    <Icon name="PackagePlus" size={16} className="mr-2" />
                    Добавить товары вручную
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => navigate('/crm/inventory/returns-inspection')}
                >
                  <Icon name="Search" size={16} className="mr-2" />
                  Возвраты на осмотре
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onClick={() => setReprintOpen(true)}>
                    <Icon name="FileWarning" size={16} className="mr-2" />
                    Пропущенные стикеры
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Работа на сейчас — три плитки с числами. Кладовщик видит, сколько вещей ждёт
            на каждом шаге, и нажимает ту, где есть работа: пустые остаются серыми и в
            глаза не лезут. Раньше два из этих окон вообще нельзя было открыть — кнопок
            к ним на странице не было. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <WorkTile
            icon="Boxes"
            title="Разложить по полкам"
            hint="Приняты, полка не назначена"
            count={pendingShelf.length}
            onClick={() => setPlaceOpen(true)}
          />
          <WorkTile
            icon="ScanLine"
            title="Собрать с полок"
            hint="Подобраны под заказы, ждут стикера"
            count={matchedFromStock.length}
            onClick={() => setShipLabelOpen(true)}
          />
          <WorkTile
            icon="Truck"
            title="Товар к подбору"
            hint="Список к сборке на сегодня"
            count={pickingPending}
            onClick={() => navigate('/crm/inventory/goods-picking')}
          />
        </div>

        <ReceiveReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          onDone={load}
        />
        <PlaceOnShelfDialog
          open={placeOpen}
          onOpenChange={setPlaceOpen}
          shelves={shelves}
          pendingItems={pendingShelf}
          onDone={load}
        />
        <ShipLabelDialog
          open={shipLabelOpen}
          onOpenChange={setShipLabelOpen}
          matched={matchedFromStock}
          onDone={load}
        />
        <MoveShelfDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          shelves={shelves}
          onDone={load}
        />
        {canReceiveManually && (
          <AdminReceiveDialog
            open={adminReceiveOpen}
            onOpenChange={setAdminReceiveOpen}
            shelves={shelves}
            onDone={load}
          />
        )}
        {isAdmin && (
          <ReprintReportDialog open={reprintOpen} onOpenChange={setReprintOpen} />
        )}

        {/* Привезли с ПВЗ, но ещё не осмотрели. Такой товар нельзя продавать:
            он не проверен и в подбор не идёт, пока не ляжет на полку. */}
        {uncheckedReturns > 0 && (
          <button
            type="button"
            onClick={() => navigate('/crm/shipments/receive-returns')}
            className="flex w-full items-center gap-3 rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-left"
          >
            <Icon name="PackageOpen" size={24} className="shrink-0 text-violet-600" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-violet-900">
                Непроверенные возвраты: {uncheckedReturns} шт.
              </p>
              <p className="text-sm text-violet-900">
                Забрали с пункта выдачи, но ещё не осмотрели. В подбор не попадут,
                пока не разберёте и не положите на полку
              </p>
            </div>
            <Icon name="ChevronRight" size={18} className="shrink-0 text-violet-600" />
          </button>
        )}

        <GoodsWarehouseFilters
          search={search}
          setSearch={setSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          materialFilter={materialFilter}
          setMaterialFilter={setMaterialFilter}
          materials={materialsList}
          widthFilter={widthFilter}
          setWidthFilter={setWidthFilter}
          widths={widthsList}
          heightFilter={heightFilter}
          setHeightFilter={setHeightFilter}
          heights={heightsList}
          shelfCounts={shelfCounts}
          noShelfCount={noShelfCount}
          shelfFilter={shelfFilter}
          setShelfFilter={setShelfFilter}
          shelves={shelves}
          activeFiltersCount={activeFiltersCount}
          onReset={resetFilters}
        />

        {/* Сколько вещей отобрано текущим фильтром — кладовщик видит объём работы до того,
            как пойдёт к стеллажу, и может распечатать список, чтобы собирать с бумагой. */}
        {!loading && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {shelfFilter
                ? `На выбранной полке: ${filtered.length} шт`
                : `Показано товаров: ${filtered.length}`}
            </p>
            {filtered.length > 0 && (
              <Button variant="outline" size="sm" onClick={handlePrintPickList}>
                <Icon name="Printer" size={14} className="mr-2" />
                Печать списка
              </Button>
            )}
          </div>
        )}

        <GoodsWarehouseTable
          loading={loading}
          items={filtered}
          onReturnToWorkshop={handleReturn}
          onMarkLost={handleMarkLost}
          isAdmin={isAdmin}
          onDelete={handleDeleteGoods}
        />
      </div>
    </CrmLayout>
  );
};

export default GoodsWarehouse;