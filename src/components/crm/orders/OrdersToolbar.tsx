import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';

interface OrdersToolbarProps {
  onOpenManual: () => void;
}

const OrdersToolbar = ({ onOpenManual }: OrdersToolbarProps) => {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={onOpenManual}>
          <Icon name="Plus" size={16} className="mr-1.5" />
          Добавить заказ вручную
        </Button>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700" disabled>
          <Icon name="RefreshCw" size={16} className="mr-1.5" />
          Загрузить заказы с API
        </Button>
        <Button className="bg-amber-500 text-white hover:bg-amber-600" disabled>
          <Icon name="Ban" size={16} className="mr-1.5" />
          Проверить отменённые заказы
        </Button>
        <Button className="bg-teal-600 text-white hover:bg-teal-700" disabled>
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
            <SelectItem value="individual">Индивидуальный</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
};

export default OrdersToolbar;
