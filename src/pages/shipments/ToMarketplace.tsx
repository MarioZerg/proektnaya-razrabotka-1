import { usePolling } from '@/hooks/usePolling';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  fetchSupplies,
  fetchSupplyDetail,
  createSupply,
  moveSupplyStatus,
  type Supply,
  type SupplyType,
  type OzonDeliveryMethod,
} from '@/lib/marketplaceSuppliesApi';
import { fetchGazelkaPlans } from '@/lib/gazelkaApi';
import { fetchMarketplaceIntegrations, type Shop } from '@/lib/marketplaceIntegrationsApi';
import ShopTabs from '@/components/crm/ShopTabs';
import CreateOzonFboDialog from '@/components/crm/marketplaceSupplies/CreateOzonFboDialog';
import SupplyTypeWidgets from '@/components/crm/marketplaceSupplies/SupplyTypeWidgets';
import ToMarketplaceFilters from '@/components/crm/marketplaceSupplies/ToMarketplaceFilters';
import ToMarketplaceTable from '@/components/crm/marketplaceSupplies/ToMarketplaceTable';
import FboProposalsPanel from '@/components/crm/marketplaceSupplies/FboProposalsPanel';
import ConfirmFbsSupplyDialog, {
  type PendingFbs,
} from '@/components/crm/marketplaceSupplies/ConfirmFbsSupplyDialog';
import { createOptions } from '@/components/crm/marketplaceSupplies/toMarketplaceConstants';
import { importOzonFboComposition } from '@/lib/ozonFboApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const ToMarketplace = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  /** Полный список по текущим фильтрам, кроме схемы: по нему считаются плашки FBS/FBO. */
  const [allSupplies, setAllSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Поставка FBS, которую кладовщик собирается создать: ждём подтверждения, что
  // он понимает — до её отгрузки смену закрыть не получится.
  // Для WB FBS здесь же выбирают тип поставки: обычная или B2B (юрлица).
  const [pendingFbs, setPendingFbs] = useState<PendingFbs | null>(null);
  /** OZON FBS уже отсканирована и ждёт 12 часов: её можно закрыть и создать новую. */
  const [closeToCreate, setCloseToCreate] = useState<Supply | null>(null);
  const [ozonFboDialogOpen, setOzonFboDialogOpen] = useState(false);
  // FBS-поставки создаёт и собирает кладовщик — товар он отбирает со своих полок. Менеджер
  // ведёт FBO-поставки и только наблюдает за сборкой FBS в реальном времени.
  const isManagerRole = user?.role === 'manager';
  const availableCreateOptions = isManagerRole
    ? createOptions.filter((o) => o.type !== 'FBS')
    : createOptions;

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
  const [feed, setFeed] = useState<'supplies' | 'proposals'>('supplies');
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

  const handleCreate = async (marketplace: string, type: SupplyType) => {
    if (marketplace === 'OZON' && type === 'FBS') {
      const open = allSupplies.filter(
        (s) => s.marketplace === 'OZON' && s.type === 'FBS' && s.status !== 'Выполнена' && s.status !== 'Отменена',
      );
      const busy = open.find((s) => s.status !== 'Отгружено');
      if (busy) {
        toast({
          title: 'Поставка ещё не закрыта',
          description: `${busy.supplyNumber || 'Эта поставка'} ещё в работе. Новую создать нельзя.`,
          variant: 'destructive',
        });
        return;
      }
      const ready = open.find((s) => s.status === 'Отгружено');
      if (ready) {
        setCloseToCreate(ready);
        return;
      }
    }
    if (marketplace === 'OZON' && type === 'FBO') {
      setOzonFboDialogOpen(true);
      return;
    }
    // FBS-поставка попадает в задания смены кладовщика и держит её до отгрузки.
    // Предупреждаем заранее: человек должен понимать, что берёт работу на сегодня,
    // а не оставляет её на завтра. Менеджера и админа это не касается — смену
    // держат только задания кладовщика.
    const shiftWarning = type === 'FBS' && isStorekeeperRole(user?.role);
    // WB FBS: заказы юрлиц (B2B) WB не смешивает с обычными — тип выбирают сразу.
    if (shiftWarning || (marketplace === 'WB' && type === 'FBS')) {
      setPendingFbs({ marketplace, type, shiftWarning });
      return;
    }
    await createSupplyNow(marketplace, type, false);
  };

  const closeReadyAndCreate = async () => {
    if (!closeToCreate) return;
    const prev = closeToCreate;
    setCreating(true);
    try {
      await moveSupplyStatus(prev.id, 'Выполнена');
    } catch (e) {
      toast({
        title: 'Не удалось закрыть поставку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setCreating(false);
      return;
    }
    setCloseToCreate(null);
    await createSupplyNow('OZON', 'FBS', false);
  };

  const createSupplyNow = async (marketplace: string, type: SupplyType, isB2b: boolean) => {
    // Поставка всегда заводится в тот магазин, чья вкладка открыта.
    if (!shopId) return;
    setCreating(true);
    try {
      const res = await createSupply({ marketplace, type, shopId, createdBy: user?.id, isB2b });
      toast({
        title: isB2b ? 'Поставка B2B создана' : 'Поставка создана',
        description: `#${res.id} — заполните товары на карточке`,
      });
      navigate(`/crm/shipments/to-marketplace/${res.id}`);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  // Импорт выбранной заявки OZON FBO: создаёт нашу поставку и заказы на конвейер из
  // товарного состава заявки, затем открывает поставку. Если заявка уже загружена — просто
  // открывает существующую поставку (backend переиспользует её).
  const handleImportOzonApplication = async (orderId: number) => {
    setCreating(true);
    try {
      const res = await importOzonFboComposition(orderId, { id: user?.id, name: user?.name });
      const parts = [`создано заказов: ${res.created}`];
      if (res.skippedNoItem) parts.push(`без товара: ${res.skippedNoItem}`);
      toast({
        title: `Заявка ${res.orderNumber || ''} загружена`,
        description: `Товаров в заявке: ${res.totalItems}. ${parts.join(', ')}.`,
      });
      setOzonFboDialogOpen(false);
      navigate(`/crm/shipments/to-marketplace/${res.supplyId}`);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleCreateOzonDraft = async (deliveryMethod: OzonDeliveryMethod) => {
    if (!shopId) return;
    setCreating(true);
    try {
      const res = await createSupply({
        marketplace: 'OZON',
        type: 'FBO',
        shopId,
        createdBy: user?.id,
        ozonDeliveryMethod: deliveryMethod,
      });
      toast({ title: 'Черновик заявки создан', description: `#${res.id} — заполните данные заявки` });
      setOzonFboDialogOpen(false);
      navigate(`/crm/shipments/to-marketplace/${res.id}`);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const currentShop = shops.find((s) => s.id === shopId) || null;

  const resetFilters = () => {
    setStatusFilter('open');
    setMarketplaceFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  return (
    <CrmLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Поставка в маркет</h1>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              {currentShop
                ? `Отгрузка готового товара магазина «${currentShop.name}» на маркетплейс`
                : 'Формирование отгрузки готового товара со склада на маркетплейс'}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={creating} className="w-full shrink-0 sm:w-auto">
                <Icon name="Plus" size={16} className="mr-2" />
                Создать поставку
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {availableCreateOptions.map((opt) => (
                <DropdownMenuItem key={opt.label} onClick={() => handleCreate(opt.marketplace, opt.type)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Вкладки магазинов. У МЕГАТЮЛЬ и ДЮНЫ разные кабинеты на площадке:
            поставки собираются отдельно, а вещь чужого магазина в короб не
            отсканируется. Пока магазин один, вкладки не рисуются. */}
        <ShopTabs shops={shops} value={shopId} onChange={setShopId} />

        <div className="flex gap-2">
          <Button
            type="button"
            variant={feed === 'supplies' ? 'default' : 'outline'}
            onClick={() => setFeed('supplies')}
          >
            Поставки
          </Button>
          <Button
            type="button"
            variant={feed === 'proposals' ? 'default' : 'outline'}
            onClick={() => setFeed('proposals')}
          >
            Авто предложения поставки FBO
          </Button>
        </div>

        {feed === 'proposals' ? (
          <FboProposalsPanel
            shopId={shopId}
            actorId={user?.id}
            actorName={user?.name}
            isAdmin={user?.role === 'admin'}
            onOpenSupply={(id) => {
              setFeed('supplies');
              navigate(`/crm/shipments/to-marketplace/${id}`);
            }}
          />
        ) : (
        <>
        {/* Создание, схема и фильтры — одна верхняя полоса, список сразу под ней. */}
        <div className="space-y-3">
          {!loading && allSupplies.length > 0 && (
            <SupplyTypeWidgets
              supplies={allSupplies}
              activeType={typeFilter}
              onSelectType={setTypeFilter}
            />
          )}
          <ToMarketplaceFilters
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            marketplaceFilter={marketplaceFilter}
            setMarketplaceFilter={setMarketplaceFilter}
            dateFrom={dateFrom}
            setDateFrom={setDateFrom}
            dateTo={dateTo}
            setDateTo={setDateTo}
            search={search}
            setSearch={setSearch}
            onReset={resetFilters}
          />
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить поставки"
            description={listError}
            onRetry={load}
          />
        )}

        <ToMarketplaceTable
          loading={loading}
          error={listError}
          supplies={supplies}
          onOpen={(id) => navigate(`/crm/shipments/to-marketplace/${id}`)}
        />
        </>
        )}
      </div>

      <AlertDialog open={!!closeToCreate} onOpenChange={(v) => !v && setCloseToCreate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть прошлую поставку?</AlertDialogTitle>
            <AlertDialogDescription>
              {closeToCreate?.supplyNumber || 'Поставка'} отсканирована целиком и сама
              закроется через 12 часов. Закройте её сейчас — и можно создать новую.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={closeReadyAndCreate}>Закрыть и создать</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmFbsSupplyDialog
        pendingFbs={pendingFbs}
        setPendingFbs={setPendingFbs}
        onConfirm={createSupplyNow}
      />

      <CreateOzonFboDialog
        open={ozonFboDialogOpen}
        onOpenChange={setOzonFboDialogOpen}
        creating={creating}
        onImportApplication={handleImportOzonApplication}
        onCreateDraft={handleCreateOzonDraft}
      />
    </CrmLayout>
  );
};

export default ToMarketplace;