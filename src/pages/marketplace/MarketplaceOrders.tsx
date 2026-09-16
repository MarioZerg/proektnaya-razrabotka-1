import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrders,
  searchOrders,
  createManualOrder,
  updateOrder,
  deleteOrder,
  restoreOrder,
  type Order,
} from '@/lib/ordersApi';
import { fetchMarketplaceItems, type MarketplaceItem, type Shop } from '@/lib/marketplaceItemsApi';
import { syncWbOrders } from '@/lib/wbFbsApi';
import { syncOzonOrders, refreshAllOzonStatuses } from '@/lib/ozonFbsApi';
import { syncYandexOrders } from '@/lib/yandexMarketApi';
import { useAuth } from '@/context/AuthContext';
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
  emptyManualRow,
  marketplaceLogo,
  type EditFormState,
  type ManualOrderRow,
} from '@/components/crm/orders/ordersShared';
import OrdersToolbar, {
  type StatusFilter,
  type MarketplaceFilter,
  type TypeFilter,
} from '@/components/crm/orders/OrdersToolbar';
import OrdersTable from '@/components/crm/orders/OrdersTable';
import OrdersSummary from '@/components/crm/orders/OrdersSummary';
import EditOrderDialog from '@/components/crm/orders/EditOrderDialog';
import CreateManualOrderDialog from '@/components/crm/orders/CreateManualOrderDialog';
import PullOrderByNumberDialog from '@/components/crm/orders/PullOrderByNumberDialog';
import BulkCancelDialog from '@/components/crm/orders/BulkCancelDialog';
import { findDuplicateOrders } from '@/lib/findDuplicateOrders';
import Icon from '@/components/ui/icon';

const MarketplaceOrders = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  // Заказами с маркетплейса управляет только администратор: он их подгружает по API,
  // заводит вручную, правит и удаляет. Кладовщик и менеджер открывают эту вкладку как
  // справку — посмотреть, что за заказ и в каком он статусе. Менеджер удаляет заказы
  // в другом месте — в поставках FBO, где это часть его работы.
  const canManageOrders = user?.role === 'admin';
  const [orders, setOrders] = useState<Order[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncingOzon, setSyncingOzon] = useState(false);
  const [syncingYandex, setSyncingYandex] = useState(false);
  const [refreshingOzon, setRefreshingOzon] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketplaceItems, setMarketplaceItems] = useState<MarketplaceItem[]>([]);
  // Магазины нужны в подборе товара: карточки МЕГАТЮЛЬ и ДЮНЫ лежат вперемешку,
  // и без метки один и тот же размер не отличить.
  const [shops, setShops] = useState<Shop[]>([]);

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form, setForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  // Аварийная догрузка заказа OZON по номеру — когда его нет на конвейере.
  const [pullOpen, setPullOpen] = useState(false);
  const [manualRows, setManualRows] = useState<ManualOrderRow[]>([emptyManualRow()]);
  const [manualSaving, setManualSaving] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [marketplaceFilter, setMarketplaceFilter] = useState<MarketplaceFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // Материал, который закончился: по нему админ снимает заказы с конвейера.
  const [materialFilter, setMaterialFilter] = useState<string>('all');
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  // Заказ, который админ собрался снять с конвейера — ждёт подтверждения.
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Заказ, который возвращают на конвейер после ошибочного снятия.
  const [restoreTarget, setRestoreTarget] = useState<Order | null>(null);
  const [restoring, setRestoring] = useState(false);

  // ПОИСК ПО НОМЕРУ ЗАКАЗА.
  //
  // Просеивать загруженный список бесполезно: сервер отдаёт только свежую часть
  // истории (примерно месяц) и свежие отмены — дальше ответ не помещается в
  // потолок платформы. Заказа прошлого квартала в списке физически НЕТ, и на
  // вопрос «где мой заказ» ответить было нечем.
  //
  // Поэтому поиск уходит на сервер: он ищет прямо в базе и находит заказ любой
  // давности. Результат показываем вместо списка, не трогая сам список, — стоит
  // очистить поле, и конвейер возвращается на экран без перезагрузки.
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Order[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = () => {
    setLoading(true);
    fetchOrders()
      .then(setOrders)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetchMarketplaceItems().then(({ items, shops: shopList }) => {
      setMarketplaceItems(items);
      setShops(shopList);
    });
  }, []);

  // Ищем не на каждую букву: пока человек печатает номер, запрос ушёл бы
  // десяток раз подряд, а нужен только последний. Ждём паузу в наборе.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      searchOrders(q)
        .then((found) => {
          // Ответ на устаревший запрос игнорируем: иначе медленный ответ по
          // старому куску номера перетёр бы результат свежего.
          if (!cancelled) setSearchResults(found);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);

  // ВОЗВРАТ ОШИБОЧНО СНЯТОГО ЗАКАЗА НА КОНВЕЙЕР.
  //
  // Возвращаем только СВОЮ отмену: отменённое маркетплейсом сервер вернуть не
  // даст — отправления на площадке уже нет, и вещь будет некуда отгрузить.
  const handleRestore = async () => {
    const order = restoreTarget;
    if (!order) return;
    setRestoring(true);
    try {
      const res = await restoreOrder(order.id);
      const extra = res.restoredIds?.length > 1
        ? ` Вместе со связкой Яндекса вернулось вещей: ${res.restoredIds.length}.`
        : '';
      toast({
        title: `Заказ ${order.orderNumber} вернулся в работу`,
        description: `Он снова в начале конвейера — ищите его в фильтре «Новые заказы».${extra}`,
      });
      setRestoreTarget(null);
      // Обновляем и список, и результат поиска: заказ чаще всего нашли поиском,
      // и в нём должен смениться статус, а не остаться старый.
      load();
      if (search.trim().length >= 2) {
        searchOrders(search.trim()).then(setSearchResults).catch(() => undefined);
      }
    } catch (err) {
      toast({
        title: 'Заказ не вернулся в работу',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setRestoring(false);
    }
  };

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    setForm({
      orderNumber: order.orderNumber,
      marketplace: order.marketplace,
      orderType: order.orderType,
      status: order.status,
      product: order.product || '',
    });
  };

  const closeEdit = () => {
    setEditingOrder(null);
    setForm(null);
  };

  const handleSave = async () => {
    if (!editingOrder || !form) return;
    setSaving(true);
    try {
      await updateOrder(editingOrder.id, {
        orderNumber: form.orderNumber.trim(),
        marketplace: form.marketplace,
        orderType: form.orderType,
        status: form.status,
        product: form.product,
      });
      closeEdit();
      load();
    } catch (err) {
      toast({
        title: 'Не удалось сохранить заказ',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // СНЯТИЕ ЗАКАЗА — ДЕЙСТВИЕ НЕОБРАТИМОЕ, ПОЭТОМУ ЧЕРЕЗ ПОДТВЕРЖДЕНИЕ.
  //
  // Заказ уходит не только с нашего конвейера: сервер отменяет его по API
  // маркетплейса, и вернуть его оттуда нельзя. Раньше кнопка срабатывала сразу от
  // одного нажатия, а стояла в строке рядом с «Изменить» — промахнуться было легко.
  const handleDelete = async () => {
    const order = deleteTarget;
    if (!order) return;
    setDeleting(true);
    try {
      const res = await deleteOrder(order.id);
      const extra = res.cancelledIds?.length > 1
        ? ` Вместе со связкой Яндекса снято вещей: ${res.cancelledIds.length}.`
        : '';
      toast({
        title: `Заказ ${order.orderNumber} снят с конвейера`,
        description: res.note
          ? `${res.note}.${extra}`
          : `Отменён на маркетплейсе и скрыт из списка — найти его можно в фильтре «Отменённые».${extra}`,
      });
      setDeleteTarget(null);
      load();
    } catch (err) {
      // Отказ показываем словами: сервер объясняет, почему снять нельзя (заказ уже
      // раскроен, взят в цехе) или что именно ответил маркетплейс. Молча не
      // изменившийся список читается как «нажал, и не сработало».
      toast({
        title: 'Заказ не снят',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  // Загрузка новых FBS-заказов с WildBerries через API. Создаёт их в системе со статусом
  // «Новые», чтобы конвейер производства их подхватил. Нераспознанные артикулы (нет товара
  // в справочнике) показываем отдельным предупреждением.
  const handleSyncWb = async () => {
    setSyncing(true);
    try {
      const r = await syncWbOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.skippedNoItem) parts.push(`без товара ${r.skippedNoItem}`);
      toast({
        title: r.sandbox ? 'WB (тестовый режим): загрузка завершена' : 'Заказы WB загружены',
        description: `Получено с WB: ${r.totalFromWb}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.article || u.nmId).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с WildBerries',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  // Загрузка новых FBS-заказов с OZON (только новые, требующие сборки). Работает в режиме
  // чтения — статусы на OZON не меняются. Нераспознанные артикулы показываем предупреждением.
  const handleSyncOzon = async () => {
    setSyncingOzon(true);
    try {
      const r = await syncOzonOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.skippedNoItem) parts.push(`без товара ${r.skippedNoItem}`);
      toast({
        title: 'Заказы OZON загружены',
        description: `Новых отправлений с OZON: ${r.totalFromOzon}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.ozonSku || u.offerId).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      // Задвоение — серьёзно: одна вещь попала в систему дважды, значит дважды спишется
      // материал и дважды начислится зарплата. Сообщаем сразу и называем отправления.
      if (r.duplicates && r.duplicates.length > 0) {
        const list = r.duplicates
          .map((d) => `${d.postingNumber} (в системе ${d.actual}, у OZON ${d.expected})`)
          .join('; ');
        toast({
          title: `Обнаружено задвоение заказов: ${r.duplicates.length}`,
          description: `Проверьте отправления — лишние вещи нужно отменить: ${list}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с OZON',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncingOzon(false);
    }
  };

  // Загрузка новых FBS-заказов с Яндекс Маркета. Вещи одного заказа покупателя связываются
  // в группу: ярлык на них общий, поэтому по цеху они едут вместе — один закройщик, одна швея.
  const handleSyncYandex = async () => {
    setSyncingYandex(true);
    try {
      const r = await syncYandexOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.matchedFromStock) parts.push(`закрыто со склада ${r.matchedFromStock}`);
      toast({
        title: 'Заказы Яндекс Маркета загружены',
        description: `Заказов покупателей: ${r.orders.length}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.offerId || u.shopSku).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с Яндекс Маркета',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncingYandex(false);
    }
  };

  // Разом обновляет статусы всех OZON-заказов (сборка/отгрузка/доставка/доставлен) — читает
  // актуальные статусы с OZON, ничего не двигая на его стороне.
  const handleRefreshOzonStatuses = async () => {
    setRefreshingOzon(true);
    try {
      const r = await refreshAllOzonStatuses();
      toast({
        title: 'Статусы OZON обновлены',
        description: `Проверено заказов: ${r.checked}, изменилось статусов: ${r.updated}.`,
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось обновить статусы OZON',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRefreshingOzon(false);
    }
  };

  const openManual = () => {
    setManualRows([emptyManualRow()]);
    setManualOpen(true);
  };

  // Каждая строка формы — отдельный уникальный заказ (1 заказ = 1 заявка), поэтому заказы
  // создаются последовательно отдельными запросами (не пачкой), чтобы дубль номера или
  // другая ошибка в одной строке не мешала создать остальные и была понятна пользователю.
  const handleManualCreate = async () => {
    setManualSaving(true);
    let createdCount = 0;
    const failed: string[] = [];
    try {
      for (const [idx, row] of manualRows.entries()) {
        if (!row.marketplaceItemId) continue;
        try {
          // Номер заказа присваивается автоматически на сервере (сквозной счётчик 00000-01).
          // За один вызов сервер создаёт столько заявок, сколько изделий заказали.
          const res = await createManualOrder({
            orderType: row.orderType,
            marketplaceItemId: row.marketplaceItemId,
            quantity: row.quantity,
          });
          createdCount += Number(res?.created) || row.quantity || 1;
        } catch (err) {
          failed.push(`Заказ #${idx + 1}: ${err instanceof Error ? err.message : 'ошибка'}`);
        }
      }
      load();
      if (createdCount > 0) {
        toast({ title: `Создано заказов: ${createdCount}` });
      }
      if (failed.length > 0) {
        toast({
          title: `Не удалось создать: ${failed.length}`,
          description: failed.join('; '),
          variant: 'destructive',
        });
      }
      if (failed.length === 0) {
        setManualOpen(false);
      }
    } finally {
      setManualSaving(false);
    }
  };

  // Этап производства заказа определяется по sewingStatus (поле status почти всегда "Новый"
  // и реальный прогресс не отражает). Отменённые (status='Отменён') показываются только во
  // вкладке "Отменённые" и не попадают в остальные — их видно зачёркнутыми.
  const IN_PROGRESS_STAGES = ['На раскрое', 'Раскроено', 'В работе', 'Стикеровка'];
  // Заказ закрыт двумя путями: его отшили («Готовые») или вещь взяли готовой со
  // склада, минуя цех («Со склада»). Для отдела продаж это одно и то же —
  // выполненный заказ. Раньше в «Выполненных» проверялись только «Готовые», и
  // больше тысячи заказов «Со склада» не показывались НИ В ОДНОМ фильтре: они
  // приходили с сервера, но проваливались мимо всех четырёх условий.
  const DONE_STAGES = ['Готовые', 'Со склада'];
  const matchesStatus = (o: Order): boolean => {
    // Отменяют заказ на любом этапе, и sewingStatus при этом остаётся прежним
    // («Новый», «Готовые», «Со склада»), поэтому проверяем отмену первой.
    //
    // isCancelled считает сервер: отмену видит МАРКЕТПЛЕЙС, и у каждой площадки
    // своё слово для неё (ozon_status='cancelled', ym_status='...CANCELLED'), а наш
    // собственный status при этом не меняется вовсе. Раньше здесь смотрели только
    // на наш status — и вкладка «Отменённые» показывала 149 заказов вместо 1416.
    const cancelled =
      !!o.isCancelled || o.status === 'Отменён' || o.sewingStatus === 'Отменён';
    if (statusFilter === 'cancelled') return cancelled;
    if (cancelled) return false;
    if (statusFilter === 'new') return o.sewingStatus === 'Новый';
    if (statusFilter === 'in_progress') return IN_PROGRESS_STAGES.includes(o.sewingStatus);
    if (statusFilter === 'done') return DONE_STAGES.includes(o.sewingStatus);
    return true;
  };

  // Задвоенные заказы — одна вещь заведена дважды. Показываем предупреждение вверху.
  const duplicates = findDuplicateOrders(orders);

  const baseOrders = orders.filter(
    (o) =>
      matchesStatus(o) &&
      (marketplaceFilter === 'all' || o.marketplace === marketplaceFilter) &&
      (typeFilter === 'all' || o.orderType === typeFilter) &&
      (materialFilter === 'all' || o.material === materialFilter)
  );

  // ПРИ ПОИСКЕ ФИЛЬТРЫ НЕ ПРИМЕНЯЕМ.
  //
  // Человек ищет конкретный заказ по номеру, и он может оказаться отменённым или
  // отгруженным полгода назад. Наложи мы сверху вкладку статуса («Новые»), и
  // найденный заказ тут же исчез бы с экрана — выглядело бы как «поиск не
  // работает», хотя сервер его нашёл.
  const searchActive = search.trim().length >= 2;
  const visibleOrders = searchActive ? searchResults || [] : baseOrders;

  // Материалы для фильтра берём из самих заказов: в списке должно быть только то,
  // что реально стоит в очереди — иначе админ выберет ткань, по которой снимать нечего.
  const materials = Array.from(
    new Set(orders.map((o) => o.material).filter((m): m is string => !!m))
  ).sort((a, b) => a.localeCompare(b, 'ru'));

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Заказы</h1>

        {!loading && duplicates.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <Icon name="CopyX" size={18} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="font-medium text-destructive">
                Задвоенные заказы: {duplicates.length}
              </p>
              <p className="mt-1 text-muted-foreground">
                Одна вещь попала в систему дважды — лишнюю нужно отменить, иначе на неё
                спишется материал и начислится зарплата. Отправления:{' '}
                {duplicates.map((d) => d.postingNumber).join(', ')}
              </p>
            </div>
          </div>
        )}

        {!loading && <OrdersSummary orders={orders} />}

        <OrdersToolbar
          canManage={canManageOrders}
          onOpenManual={openManual}
          onSyncWb={handleSyncWb}
          syncing={syncing}
          onSyncOzon={handleSyncOzon}
          syncingOzon={syncingOzon}
          onSyncYandex={handleSyncYandex}
          syncingYandex={syncingYandex}
          onRefreshOzonStatuses={handleRefreshOzonStatuses}
          refreshingOzon={refreshingOzon}
          onPullByNumber={() => setPullOpen(true)}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          marketplaceFilter={marketplaceFilter}
          onMarketplaceChange={setMarketplaceFilter}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          materials={materials}
          materialFilter={materialFilter}
          onMaterialChange={setMaterialFilter}
          onBulkCancel={() => setBulkCancelOpen(true)}
          search={search}
          onSearchChange={setSearch}
          searching={searching}
        />

        {/* Пока идёт поиск, говорим об этом словами: пустая таблица читается как
            «ничего не нашлось», и человек уходит, не дождавшись ответа. */}
        {searchActive && (
          <p className="text-sm text-muted-foreground">
            {searching
              ? 'Ищем заказ по номеру...'
              : `Найдено заказов: ${visibleOrders.length}. Поиск идёт по всей базе — ` +
                'фильтры и вкладки статусов к нему не применяются.'}
          </p>
        )}

        <OrdersTable
          loading={searchActive ? searching && !searchResults : loading}
          orders={visibleOrders}
          onEdit={openEdit}
          onDelete={(id) =>
            setDeleteTarget(visibleOrders.find((o) => o.id === id) || null)
          }
          onRestore={setRestoreTarget}
          canManage={canManageOrders}
        />
      </div>

      {/* Подтверждение снятия: говорим прямым текстом, что заказ отменится и на
          площадке — это то, чего нельзя отыграть назад. */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Снять заказ с конвейера?</AlertDialogTitle>
            <AlertDialogDescription>
              Заказ {deleteTarget?.orderNumber} будет отменён на маркетплейсе{' '}
              {deleteTarget ? marketplaceLogo[deleteTarget.marketplace]?.label || deleteTarget.marketplace : ''}{' '}
              по API и скрыт из списка заказов. Найти его потом можно фильтром «Отменённые».
            </AlertDialogDescription>
            <AlertDialogDescription className="font-medium text-destructive">
              Отмену на площадке отыграть назад нельзя. Если маркетплейс отмену не примет,
              заказ останется на конвейере и вы увидите его ответ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Не снимать</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                // Диалог закрываем сами — только после ответа сервера: иначе админ
                // не увидит, что отмена на площадке не прошла.
                e.preventDefault();
                handleDelete();
              }}
            >
              {deleting && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
              Снять и отменить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Возврат в работу: заказ снова поедет по цеху и на него спишут ткань,
          поэтому спрашиваем подтверждение, как и при снятии. */}
      <AlertDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && !restoring && setRestoreTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Вернуть заказ в работу?</AlertDialogTitle>
            <AlertDialogDescription>
              Заказ {restoreTarget?.orderNumber} вернётся в самое начало конвейера — этап
              «Новый», без закройщика и цеха. Его снова возьмут в раскрой и отошьют.
            </AlertDialogDescription>
            <AlertDialogDescription>
              На маркетплейсе при этом ничего не меняется: вернуть можно только заказ,
              который сняли мы сами. Если отмену сделала площадка, сервер откажет —
              отправления там больше нет и отгружать вещь некуда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Не возвращать</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => {
                // Закрываем диалог сами, после ответа сервера: отказ («отменил
                // маркетплейс») админ должен увидеть, а не гадать.
                e.preventDefault();
                handleRestore();
              }}
            >
              {restoring && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
              Вернуть в работу
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditOrderDialog
        editingOrder={editingOrder}
        form={form}
        setForm={setForm}
        saving={saving}
        onClose={closeEdit}
        onSave={handleSave}
      />

      <CreateManualOrderDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        rows={manualRows}
        setRows={setManualRows}
        marketplaceItems={marketplaceItems}
        shops={shops}
        manualSaving={manualSaving}
        onCreate={handleManualCreate}
      />

      <PullOrderByNumberDialog
        open={pullOpen}
        onOpenChange={setPullOpen}
        onDone={load}
      />

      <BulkCancelDialog
        open={bulkCancelOpen}
        material={materialFilter === 'all' ? '' : materialFilter}
        marketplace={marketplaceFilter}
        onClose={() => setBulkCancelOpen(false)}
        onDone={load}
      />
    </CrmLayout>
  );
};

export default MarketplaceOrders;