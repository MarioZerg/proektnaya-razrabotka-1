import { useEffect, useState } from 'react';
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
  { marketplace: 'OZON', type: 'FBO', label: 'OZON FBO' },
  { marketplace: 'WB', type: 'FBO', label: 'WB FBO' },
];

const ToMarketplace = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [ozonFboDialogOpen, setOzonFboDialogOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState('open');
  const [typeFilter, setTypeFilter] = useState('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    fetchSupplies({
      status: statusFilter === 'open' ? undefined : statusFilter,
      type: typeFilter !== 'all' ? (typeFilter as SupplyType) : undefined,
      marketplace: marketplaceFilter !== 'all' ? marketplaceFilter : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search || undefined,
    })
      .then((data) => {
        const filtered =
          statusFilter === 'open' ? data.filter((s) => s.status !== 'Выполнена') : data;
        setSupplies(filtered);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, marketplaceFilter, dateFrom, dateTo]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

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
          <h1 className="text-xl font-bold">Поставки маркетплейса</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Формирование отгрузки готового товара со склада на маркетплейс
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={creating}>
                <Icon name="Plus" size={16} className="mr-2" />
                Создать поставку
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {createOptions.map((opt) => (
                <DropdownMenuItem key={opt.label} onClick={() => handleCreate(opt.marketplace, opt.type)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="space-y-1.5">
            <Label className="text-xs">Статус</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
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
              <SelectTrigger className="w-[130px]">
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
              <SelectTrigger className="w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все маркетплейсы</SelectItem>
                <SelectItem value="OZON">OZON</SelectItem>
                <SelectItem value="WB">WB</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Отгрузка от</Label>
            <Input type="date" className="w-[150px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Отгрузка до</Label>
            <Input type="date" className="w-[150px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <form onSubmit={handleSearch} className="flex items-end gap-1.5">
            <div className="space-y-1.5">
              <Label className="text-xs">Поиск</Label>
              <Input
                className="w-[180px]"
                placeholder="Номер поставки"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button type="submit" size="icon" variant="outline">
              <Icon name="Search" size={14} />
            </Button>
          </form>
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
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground">Номер поставки</TableHead>
                  <TableHead className="text-primary-foreground">id Газельки</TableHead>
                  <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                  <TableHead className="text-primary-foreground">Тип</TableHead>
                  <TableHead className="text-primary-foreground">Товаров</TableHead>
                  <TableHead className="text-primary-foreground">Создан</TableHead>
                  <TableHead className="text-primary-foreground">Отгрузка в Газельку</TableHead>
                  <TableHead className="text-primary-foreground">Отгрузка в маркетплейс</TableHead>
                  <TableHead className="text-primary-foreground">Выполнен</TableHead>
                  <TableHead className="text-primary-foreground"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplies.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <Badge className={statusVariant[s.status]?.className}>{s.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {s.supplyNumber ? (
                        <>
                          <div className="font-semibold">{s.supplyNumber}</div>
                          {s.supplyBarcode && (
                            <div className="text-xs text-muted-foreground">{s.supplyBarcode}</div>
                          )}
                          {s.cluster && <div className="text-xs text-muted-foreground">({s.cluster})</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{s.gazelkaId || '—'}</TableCell>
                    <TableCell>
                      <span className={marketplaceLogo[s.marketplace]?.className}>
                        {marketplaceLogo[s.marketplace]?.label || s.marketplace}
                      </span>
                    </TableCell>
                    <TableCell>{s.type}</TableCell>
                    <TableCell>
                      {s.marketplace === 'WB' && s.type === 'FBS' ? (
                        <Badge variant={s.itemsCount > 0 ? 'default' : 'outline'}>
                          {s.itemsCount} шт.
                        </Badge>
                      ) : (
                        `${s.itemsCount} шт.`
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(s.createdAt)}</TableCell>
                    <TableCell>{s.shipToGazelkaAt ? formatDate(s.shipToGazelkaAt) : '—'}</TableCell>
                    <TableCell>{s.shipToMarketplaceAt ? formatDate(s.shipToMarketplaceAt) : '—'}</TableCell>
                    <TableCell>{s.completedAt ? formatDate(s.completedAt) : '—'}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => navigate(`/crm/shipments/to-marketplace/${s.id}`)}
                      >
                        <Icon name="Pencil" size={14} />
                      </Button>
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