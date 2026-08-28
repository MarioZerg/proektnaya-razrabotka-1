import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchSupplies,
  createSupply,
  type Supply,
  type SupplyType,
  type OzonDeliveryMethod,
} from '@/lib/marketplaceSuppliesApi';
import CreateOzonFboDialog from '@/components/crm/marketplaceSupplies/CreateOzonFboDialog';
import SupplySewingProgress from '@/components/crm/marketplaceSupplies/SupplySewingProgress';
import SupplyTypeWidgets from '@/components/crm/marketplaceSupplies/SupplyTypeWidgets';
import { importOzonFboComposition } from '@/lib/ozonFboApi';
import { formatDate, formatDateTime } from '@/lib/dateUtils';

const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

const statusVariant: Record<string, { className: string }> = {
  Открытая: { className: 'bg-slate-500 text-white hover:bg-slate-500' },
  'На сборке': { className: 'bg-sky-500 text-white hover:bg-sky-500' },
  Отгрузка: { className: 'bg-amber-500 text-white hover:bg-amber-500' },
  Выполнена: { className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
};

const createOptions: Array<{ marketplace: string; type: SupplyType; label: string }> = [
  { marketplace: 'OZON', type: 'FBS', label: 'OZON FBS' },
  { marketplace: 'WB', type: 'FBS', label: 'WB FBS' },
  { marketplace: 'Yandex', type: 'FBS', label: 'Яндекс FBS' },
  { marketplace: 'OZON', type: 'FBO', label: 'OZON FBO' },
  { marketplace: 'WB', type: 'FBO', label: 'WB FBO' },
];

const ToMarketplace = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  /** Полный список по текущим фильтрам, кроме схемы: по нему считаются плашки FBS/FBO. */
  const [allSupplies, setAllSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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

        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={creating}>
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

          <div className="space-y-1.5">
            <Label className="text-xs">Статус</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Все активные</SelectItem>
                <SelectItem value="Открытая">Открытая</SelectItem>
                <SelectItem value="На сборке">На сборке</SelectItem>
                <SelectItem value="Отгрузка">Отгрузка</SelectItem>
                <SelectItem value="Выполнена">Выполнена</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Тип</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                <SelectItem value="FBS">FBS</SelectItem>
                <SelectItem value="FBO">FBO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Маркетплейс</Label>
            <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
              <SelectTrigger className="w-full sm:w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все маркетплейсы</SelectItem>
                <SelectItem value="OZON">OZON</SelectItem>
                <SelectItem value="WB">WB</SelectItem>
                <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* 170px, а не 150: в поле даты браузер рисует свою кнопку календаря
              справа, и при 150px её обрезало краем — виден был только левый
              край значка. Дата с разделителями и кнопка вместе требуют больше
              места, чем обычное поле такой же ширины. */}
          <div className="space-y-1.5">
            <Label className="text-xs">Отгрузка от</Label>
            <Input type="date" className="w-full sm:w-[170px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Отгрузка до</Label>
            <Input type="date" className="w-full sm:w-[170px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          {/* Ищем по ходу набора — кнопка больше не нужна. Раньше без нажатия на
              неё набранный запрос не применялся, и человек видел старый список. */}
          <div className="space-y-1.5">
            <Label className="text-xs">Поиск</Label>
            <div className="relative">
              <Icon
                name="Search"
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="w-full pl-8 sm:w-[180px]"
                placeholder="Номер поставки"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <Icon name="X" size={14} className="mr-1" />
            Сбросить фильтр
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : supplies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Поставок пока нет</p>
        ) : (
          // Таблица без горизонтальной прокрутки.
          // Раньше колонок было тринадцать, и кнопка открытия стояла последней —
          // за краем экрана. Кладовщик на планшете сначала листал таблицу вправо
          // и только потом мог зайти в поставку. Теперь связанные данные собраны
          // в одну ячейку (номер с штрихкодом, четыре даты — в колонку «Сроки»),
          // всё помещается на экран, а открывается поставка нажатием на строку.
          <div className="overflow-hidden rounded-md border border-border">
            <Table className="min-w-0 table-fixed">
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-[26%] whitespace-normal text-primary-foreground">Поставка</TableHead>
                  <TableHead className="w-[16%] whitespace-normal text-primary-foreground">Статус</TableHead>
                  <TableHead className="w-[14%] whitespace-normal text-primary-foreground">Маркетплейс</TableHead>
                  <TableHead className="w-[13%] whitespace-normal text-primary-foreground">Товаров</TableHead>
                  <TableHead className="w-[13%] whitespace-normal text-primary-foreground">Сшито</TableHead>
                  <TableHead className="w-[18%] whitespace-normal text-primary-foreground">Сроки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplies.map((s) => (
                  <TableRow
                    key={s.id}
                    // Открываем по нажатию на всю строку: попасть в неё пальцем на
                    // планшете проще, чем в маленькую кнопку у края экрана.
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => navigate(`/crm/shipments/to-marketplace/${s.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/crm/shipments/to-marketplace/${s.id}`);
                      }
                    }}
                  >
                    <TableCell className="whitespace-normal break-words align-top">
                      <div className="font-semibold">
                        {s.supplyNumber || `Поставка №${s.id}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        #{s.id}
                        {s.type ? ` · ${s.type}` : ''}
                        {s.gazelkaId ? ` · Газелька ${s.gazelkaId}` : ''}
                      </div>
                      {s.supplyBarcode && (
                        <div className="text-xs text-muted-foreground">{s.supplyBarcode}</div>
                      )}
                      {s.cluster && (
                        <div className="text-xs text-muted-foreground">({s.cluster})</div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      <div className="flex flex-col items-start gap-1">
                        <Badge className={statusVariant[s.status]?.className}>{s.status}</Badge>
                        {/* Поставку уже собирает другой кладовщик — видно сразу в списке,
                            чтобы человек не заходил внутрь впустую. */}
                        {s.lockedByName && (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                            <Icon name="Lock" size={11} />
                            Собирает: {s.lockedByName}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      <span className={marketplaceLogo[s.marketplace]?.className}>
                        {marketplaceLogo[s.marketplace]?.label || s.marketplace}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      {s.marketplace === 'WB' && s.type === 'FBS' ? (
                        <Badge variant={s.itemsCount > 0 ? 'default' : 'outline'}>
                          {s.itemsCount} шт.
                        </Badge>
                      ) : s.type === 'FBO' && s.plannedQuantity ? (
                        // Поставку FBO не выпустят, пока не собрано всё по заявке —
                        // показываем недобор сразу в списке, а не при попытке отгрузить.
                        <span
                          className={
                            s.itemsCount >= s.plannedQuantity
                              ? 'font-medium text-emerald-600'
                              : 'font-medium text-amber-600'
                          }
                        >
                          {s.itemsCount} из {s.plannedQuantity} шт.
                        </span>
                      ) : (
                        `${s.itemsCount} шт.`
                      )}
                      {/* Сколько застикерованного товара уже ждёт этой поставки.
                          Без этой строки только что созданная поставка выглядела
                          пустой («0 шт.»), хотя контейнер стоял рядом собранный, —
                          кладовщик не понимал, есть ли смысл заходить внутрь.
                          У закрытых поставок не показываем: работа по ним окончена. */}
                      {!!s.readyToScanCount && s.status !== 'Выполнена' && (
                        <div className="mt-0.5 text-xs text-amber-700">
                          ждёт сканирования: {s.readyToScanCount}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      <SupplySewingProgress total={s.sewingTotal || 0} done={s.sewingDone || 0} />
                    </TableCell>
                    {/* Четыре даты в одной ячейке. Пустые не печатаем: у открытой
                        поставки три прочерка из четырёх — это шум, а не информация. */}
                    <TableCell className="whitespace-normal align-top text-xs">
                      <div className="text-muted-foreground">
                        Создан: {formatDateTime(s.createdAt)}
                      </div>
                      {s.shipToGazelkaAt && (
                        <div className="text-muted-foreground">
                          В Газельку: {formatDate(s.shipToGazelkaAt)}
                        </div>
                      )}
                      {s.shipToMarketplaceAt && (
                        <div className="text-muted-foreground">
                          В маркет: {formatDate(s.shipToMarketplaceAt)}
                        </div>
                      )}
                      {s.completedAt && (
                        <div className="font-medium text-emerald-600">
                          Выполнен: {formatDate(s.completedAt)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

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