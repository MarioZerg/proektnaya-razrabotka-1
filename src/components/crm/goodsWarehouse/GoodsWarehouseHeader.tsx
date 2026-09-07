import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface GoodsWarehouseHeaderProps {
  isAdmin: boolean;
  /** Кладовщику тоже можно заводить вещь вручную — излишек несут прямо ему. */
  canReceiveManually: boolean;
  onMove: () => void;
  onAdminReceive: () => void;
  onReprint: () => void;
  /** Выгрузить товарный состав в Excel для FBO-поставки. */
  onExport?: () => void;
  exporting?: boolean;
  /** Менеджеру складские действия не нужны — он только собирает состав поставки. */
  stockOnly?: boolean;
}

/** Шапка склада товара: заголовок и редкие действия под кнопкой «Ещё». */
const GoodsWarehouseHeader = ({
  isAdmin,
  canReceiveManually,
  onMove,
  onAdminReceive,
  onReprint,
  onExport,
  exporting = false,
  stockOnly = false,
}: GoodsWarehouseHeaderProps) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">Склад товара</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {stockOnly
            ? 'Свободный остаток на полках — товарный состав для FBO-поставки'
            : 'Готовые изделия по полкам — источник для поставок на маркетплейс'}
        </p>
      </div>
      {/* Редкие действия убраны под «Ещё»: раньше десять кнопок в один ряд
          переносились на две-три строки, и глазами приходилось искать нужную. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Выгрузка — главное действие менеджера, поэтому отдельной кнопкой, а не
            в «Ещё»: он заходит на склад ровно за этим файлом. */}
        {onExport && (
          <Button onClick={onExport} disabled={exporting}>
            <Icon
              name={exporting ? 'Loader2' : 'FileSpreadsheet'}
              size={16}
              className={`mr-2 ${exporting ? 'animate-spin' : ''}`}
            />
            {exporting ? 'Готовим файл...' : 'Выгрузить в Excel'}
          </Button>
        )}
        {!stockOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Icon name="Ellipsis" size={16} className="mr-2" />
              Ещё
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={onMove}>
              <Icon name="ArrowLeftRight" size={16} className="mr-2" />
              Сменить полку
            </DropdownMenuItem>
            {canReceiveManually && (
              <DropdownMenuItem onClick={onAdminReceive}>
                <Icon name="PackagePlus" size={16} className="mr-2" />
                Добавить товары вручную
              </DropdownMenuItem>
            )}
            {isAdmin && (
              <DropdownMenuItem onClick={onReprint}>
                <Icon name="FileWarning" size={16} className="mr-2" />
                Пропущенные стикеры
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
    </div>
  );
};

export default GoodsWarehouseHeader;