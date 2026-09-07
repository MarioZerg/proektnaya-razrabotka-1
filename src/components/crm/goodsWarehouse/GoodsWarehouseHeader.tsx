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
  /** Выгрузить файл строго по шаблону OZON — грузится в кабинет площадки как есть. */
  onExportOzon?: () => void;
  exportingOzon?: boolean;
  /** Менеджеру складские действия не нужны — он только собирает состав поставки. */
  stockOnly?: boolean;
  /** Сколько вещей менеджер отметил галочками для выгрузки. */
  pickedCount?: number;
  onClearPicked?: () => void;
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
  onExportOzon,
  exportingOzon = false,
  stockOnly = false,
  pickedCount = 0,
  onClearPicked,
}: GoodsWarehouseHeaderProps) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">Склад товара</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {stockOnly
            ? 'Отметьте галочками нужные размеры и выгрузите — в файл попадёт только отмеченное'
            : 'Готовые изделия по полкам — источник для поставок на маркетплейс'}
        </p>
      </div>
      {/* Редкие действия убраны под «Ещё»: раньше десять кнопок в один ряд
          переносились на две-три строки, и глазами приходилось искать нужную. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Выгрузка — главное действие менеджера, поэтому отдельной кнопкой, а не
            в «Ещё»: он заходит на склад ровно за этим файлом. */}
        {/* Отбор виден прямо на кнопке: менеджер набирает вещи по разным фильтрам и
            должен видеть общий счёт, не пролистывая таблицу обратно. */}
        {stockOnly && pickedCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-primary bg-primary/5 px-3 py-1.5 text-sm">
            <span className="font-medium">Отмечено: {pickedCount} шт.</span>
            <button
              type="button"
              onClick={onClearPicked}
              className="text-muted-foreground underline-offset-2 hover:underline"
            >
              снять
            </button>
          </div>
        )}
        {/* ДЛЯ OZON — отдельный файл по их шаблону, он же главная кнопка: именно
            его менеджер грузит в кабинет площадки. Наш общий свод (с полками и
            штрихкодами) OZON не примет, поэтому это два разных файла. */}
        {onExportOzon && (
          <Button onClick={onExportOzon} disabled={exportingOzon}>
            <Icon
              name={exportingOzon ? 'Loader2' : 'FileSpreadsheet'}
              size={16}
              className={`mr-2 ${exportingOzon ? 'animate-spin' : ''}`}
            />
            {exportingOzon
              ? 'Готовим файл...'
              : pickedCount > 0
                ? `Файл для OZON (${pickedCount})`
                : 'Файл для OZON'}
          </Button>
        )}
        {onExport && (
          <Button variant="outline" onClick={onExport} disabled={exporting}>
            <Icon
              name={exporting ? 'Loader2' : 'FileSpreadsheet'}
              size={16}
              className={`mr-2 ${exporting ? 'animate-spin' : ''}`}
            />
            {exporting
              ? 'Готовим файл...'
              : pickedCount > 0
                ? `Свод по складу (${pickedCount})`
                : 'Свод по складу'}
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