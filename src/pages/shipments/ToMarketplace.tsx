import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchSupplies,
  createSupply,
  type Supply,
  type SupplyType,
  type OzonDeliveryMethod,
} from '@/lib/marketplaceSuppliesApi';
import CreateOzonFboDialog from '@/components/crm/marketplaceSupplies/CreateOzonFboDialog';
import SupplyTypeWidgets from '@/components/crm/marketplaceSupplies/SupplyTypeWidgets';
import ToMarketplaceFilters from '@/components/crm/marketplaceSupplies/ToMarketplaceFilters';
import ToMarketplaceTable from '@/components/crm/marketplaceSupplies/ToMarketplaceTable';
import ConfirmFbsSupplyDialog from '@/components/crm/marketplaceSupplies/ConfirmFbsSupplyDialog';
import { createOptions } from '@/components/crm/marketplaceSupplies/toMarketplaceConstants';
import { importOzonFboComposition } from '@/lib/ozonFboApi';

const ToMarketplace = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  /** Полный список по текущим фильтрам, кроме схемы: по нему считаются плашки FBS/FBO. */
  const [allSupplies, setAllSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  // Поставка FBS, которую кладовщик собирается создать: ждём подтверждения, что
  // он понимает — до её отгрузки смену закрыть не получится.
  const [pendingFbs, setPendingFbs] = useState<{
    marketplace: string;
    type: SupplyType;
  } | null>(null);
  const [ozonFboDialogOpen, setOzonFboDialogOpen] = useState(false);
  // FBS-поставки создаёт и собирает кладовщик — товар он отбирает со своих полок. Менеджер
  // ведёт FBO-поставки и только наблюдает за сборкой FBS в реальном времени.
  const isManagerRole = user?.role === 'manager';
  const availableCreateOptions = isManagerRole
    ? createOptions.filter((o) => o.type !== 'FBS')
    : createOptions;

  const [statusFilter, setStatusFilter] = useState('open');
  const [typeFilter, setTypeFilter] = useState('all');
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
  const load = () => {
    setLoading(true);
    fetchSupplies({
      status: statusFilter === 'open' ? undefined : statusFilter,
      marketplace: marketplaceFilter !== 'all' ? marketplaceFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search || undefined,
    })
      .then((data) =>
        setAllSupplies(
          statusFilter === 'open' ? data.filter((s) => s.status !== 'Выполнена') : data,
        ),
      )
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, marketplaceFilter, dateFrom, dateTo]);

  // Плашки FBS/FBO считаем по полному списку: выбрав FBS, кладовщик должен
  // видеть в плашке FBO реальное число, а не ноль — иначе кажется, что поставки
  // пропали. А таблица показывает только выбранную схему.
  const supplies = useMemo(
    () => (typeFilter === 'all' ? allSupplies : allSupplies.filter((s) => s.type === typeFilter)),
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
    if (marketplace === 'OZON' && type === 'FBO') {
      setOzonFboDialogOpen(true);
      return;
    }
    // FBS-поставка попадает в задания смены кладовщика и держит её до отгрузки.
    // Предупреждаем заранее: человек должен понимать, что берёт работу на сегодня,
    // а не оставляет её на завтра. Менеджера и админа это не касается — смену
    // держат только задания кладовщика.
    if (type === 'FBS' && isStorekeeperRole(user?.role)) {
      setPendingFbs({ marketplace, type });
      return;
    }
    await createSupplyNow(marketplace, type);
  };

  const createSupplyNow = async (marketplace: string, type: SupplyType) => {
    setCreating(true);
    try {
      const res = await createSupply({ marketplace, type, createdBy: user?.id });
      toast({ title: 'Поставка создана', description: `#${res.id} — заполните товары на карточке` });
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
    setCreating(true);
    try {
      const res = await createSupply({
        marketplace: 'OZON',
        type: 'FBO',
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

  const resetFilters = () => {
    setStatusFilter('open');
    setTypeFilter('all');
    setMarketplaceFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Поставка в маркет</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Формирование отгрузки готового товара со склада на маркетплейс
          </p>
        </div>

        {/* Плашки по схемам: сколько работы каждого вида прямо сейчас. Таблица ниже
            отвечает «что с конкретной поставкой», а это — «сколько всего сегодня».
            Клик по плашке фильтрует таблицу, повторный клик снимает фильтр. */}
        {!loading && allSupplies.length > 0 && (
          <SupplyTypeWidgets
            supplies={allSupplies}
            activeType={typeFilter}
            onSelectType={setTypeFilter}
          />
        )}

        <ToMarketplaceFilters
          creating={creating}
          availableCreateOptions={availableCreateOptions}
          onCreate={handleCreate}
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

        <ToMarketplaceTable
          loading={loading}
          supplies={supplies}
          onOpen={(id) => navigate(`/crm/shipments/to-marketplace/${id}`)}
        />
      </div>

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
