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
import Icon from '@/components/ui/icon';

interface OrderRow {
  id: number;
  status: string;
  orderNumber: string;
  marketplace: 'OZON' | 'WB' | 'Yandex';
  type: 'FBO' | 'FBS';
  cluster: string;
  products: string;
  createdAt: string;
  createdAgo: string;
  completedAt: string | null;
}

const mockOrders: OrderRow[] = [
  { id: 72455, status: 'Новый', orderNumber: '119956630-172', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 200x265 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72456, status: 'Новый', orderNumber: '119956630-173', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 200x265 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72457, status: 'Новый', orderNumber: '119956630-174', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 200x265 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72458, status: 'Новый', orderNumber: '119956630-175', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x255 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72459, status: 'Новый', orderNumber: '119956630-176', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x255 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72460, status: 'Новый', orderNumber: '119956630-177', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x255 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72461, status: 'Новый', orderNumber: '119956630-178', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x265 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72462, status: 'Новый', orderNumber: '119956630-179', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x265 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
  { id: 72463, status: 'Новый', orderNumber: '119956630-180', marketplace: 'OZON', type: 'FBO', cluster: 'Краснодар', products: 'Вуаль 300x265 - 1 шт.', createdAt: '29/07/2026 09:50', createdAgo: '2 дня 7 часов назад', completedAt: null },
];

const marketplaceLogo: Record<OrderRow['marketplace'], { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

const MarketplaceOrders = () => {
  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Заказы</h1>

        <div className="flex flex-wrap gap-3">
          <Button className="bg-blue-600 text-white hover:bg-blue-700">
            <Icon name="Plus" size={16} className="mr-1.5" />
            Добавить заказ вручную
          </Button>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
            <Icon name="RefreshCw" size={16} className="mr-1.5" />
            Загрузить заказы с API
          </Button>
          <Button className="bg-amber-500 text-white hover:bg-amber-600">
            <Icon name="Ban" size={16} className="mr-1.5" />
            Проверить отменённые заказы
          </Button>
          <Button className="bg-teal-600 text-white hover:bg-teal-700">
            <Icon name="FileSpreadsheet" size={16} className="mr-1.5" />
            Добавить заказ через Excel
          </Button>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select defaultValue="new">
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Новые заказы</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="done">Выполненные</SelectItem>
              <SelectItem value="cancelled">Отменённые</SelectItem>
            </SelectContent>
          </Select>
          <Select>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="---" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ozon">OZON</SelectItem>
              <SelectItem value="wb">Wildberries</SelectItem>
              <SelectItem value="yandex">Яндекс.Маркет</SelectItem>
            </SelectContent>
          </Select>
          <Select>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="---" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fbo">FBO</SelectItem>
              <SelectItem value="fbs">FBS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">#</TableHead>
                <TableHead className="text-primary-foreground">Статус</TableHead>
                <TableHead className="text-primary-foreground">Номер заказа</TableHead>
                <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                <TableHead className="text-primary-foreground">Тип</TableHead>
                <TableHead className="text-primary-foreground">Кластер</TableHead>
                <TableHead className="text-primary-foreground">Товары</TableHead>
                <TableHead className="text-primary-foreground">Создан</TableHead>
                <TableHead className="text-primary-foreground">Выполнен</TableHead>
                <TableHead className="text-primary-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockOrders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>{o.id}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{o.status}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{o.orderNumber}</TableCell>
                  <TableCell>
                    <span className={marketplaceLogo[o.marketplace].className}>
                      {marketplaceLogo[o.marketplace].label}
                    </span>
                  </TableCell>
                  <TableCell>{o.type}</TableCell>
                  <TableCell>{o.cluster}</TableCell>
                  <TableCell>{o.products}</TableCell>
                  <TableCell>
                    <div className="whitespace-nowrap">{o.createdAt}</div>
                    <Badge variant="destructive" className="mt-1 font-normal">
                      {o.createdAgo}
                    </Badge>
                  </TableCell>
                  <TableCell>{o.completedAt || ''}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button size="icon" variant="secondary">
                        <Icon name="Pencil" size={14} />
                      </Button>
                      <Button size="icon" variant="destructive">
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </CrmLayout>
  );
};

export default MarketplaceOrders;
