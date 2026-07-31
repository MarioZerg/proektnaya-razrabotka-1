import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';

const widthOptions = ['200', '300', '400', '500', '600', '700', '800'];
const heightOptions = [
  '220', '225', '230', '235', '240', '245', '250', '255', '260', '265', '270', '275', '280', '285', '290', '295',
];
const statusOptions = ['Новые', 'На раскрое', 'Раскроено', 'В работе', 'Стикеровка', 'Готовые'];

const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days} дн. ${remHours} час. назад`;
  return `${hours} час. назад`;
};

const SewingItems = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOrders(), fetchEmployees(), fetchMaterialsData(), fetchWorkshops()])
      .then(([ordersData, employeesData, materialsData, workshopsData]) => {
        setOrders(ordersData);
        setEmployees(employeesData);
        setMaterials(materialsData.materials);
        setWorkshops(workshopsData);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalPages = Math.max(1, Math.ceil(orders.length / 10));
  const pagedOrders = orders.slice((page - 1) * 10, page * 10);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Товары для пошива</h1>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Select defaultValue="all">
            <SelectTrigger>
              <SelectValue placeholder="Все типы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              <SelectItem value="FBO">FBO</SelectItem>
              <SelectItem value="FBS">FBS</SelectItem>
            </SelectContent>
          </Select>

          <Select defaultValue="all">
            <SelectTrigger>
              <SelectValue placeholder="Все" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select>
            <SelectTrigger>
              <SelectValue placeholder="---" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ozon">OZON</SelectItem>
              <SelectItem value="wb">WB</SelectItem>
            </SelectContent>
          </Select>

          <Select defaultValue="all">
            <SelectTrigger>
              <SelectValue placeholder="Все материалы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все материалы</SelectItem>
              {materials.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select defaultValue="all">
            <SelectTrigger>
              <SelectValue placeholder="Все ширины" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все ширины</SelectItem>
              {widthOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select defaultValue="all">
            <SelectTrigger>
              <SelectValue placeholder="Все высоты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все высоты</SelectItem>
              {heightOptions.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select defaultValue="Новые">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select defaultValue="all">
            <SelectTrigger>
              <SelectValue placeholder="Все цеха" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все цеха</SelectItem>
              {workshops.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">#</TableHead>
                    <TableHead className="text-primary-foreground">Статус</TableHead>
                    <TableHead className="text-primary-foreground">Номер заказа</TableHead>
                    <TableHead className="text-primary-foreground">Кластер</TableHead>
                    <TableHead className="text-primary-foreground">Название</TableHead>
                    <TableHead className="text-primary-foreground">Ширина</TableHead>
                    <TableHead className="text-primary-foreground">Высота</TableHead>
                    <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                    <TableHead className="text-primary-foreground">Тип</TableHead>
                    <TableHead className="text-primary-foreground">Сотрудники</TableHead>
                    <TableHead className="text-primary-foreground">Создан</TableHead>
                    <TableHead className="text-primary-foreground">Выполнен</TableHead>
                    <TableHead className="text-primary-foreground" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.id}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{o.sewingStatus}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{o.orderNumber}</TableCell>
                      <TableCell>{o.cluster || '—'}</TableCell>
                      <TableCell>{o.material || '—'}</TableCell>
                      <TableCell>{o.width ?? '—'}</TableCell>
                      <TableCell>{o.height ?? '—'}</TableCell>
                      <TableCell>
                        <span className={marketplaceLogo[o.marketplace]?.className}>
                          {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                        </span>
                      </TableCell>
                      <TableCell>{o.orderType}</TableCell>
                      <TableCell>{o.assignedUserName || '—'}</TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">{formatDate(o.createdAt)}</div>
                        <Badge variant="destructive" className="mt-1 font-normal">
                          {timeAgo(o.createdAt)}
                        </Badge>
                      </TableCell>
                      <TableCell>{o.completedAt ? formatDate(o.completedAt) : ''}</TableCell>
                      <TableCell>
                        <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700">
                          <Icon name="Eye" size={14} className="mr-1.5" />
                          Просмотр
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="cursor-pointer"
                    >
                      <Icon name="ChevronLeft" size={16} />
                    </PaginationLink>
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <PaginationItem key={p}>
                      <PaginationLink
                        isActive={p === page}
                        onClick={() => setPage(p)}
                        className="cursor-pointer"
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="cursor-pointer"
                    >
                      <Icon name="ChevronRight" size={16} />
                    </PaginationLink>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default SewingItems;
