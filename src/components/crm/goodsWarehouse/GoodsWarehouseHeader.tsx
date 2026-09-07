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
  /** Выгрузить файл строго по шаблону выбранной площадки — грузится в кабинет как есть. */
  onExportFor?: (target: 'ozon' | 'wb') => void;
  exportingFor?: 'ozon' | 'wb' | null;
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
  onExportFor,
  exportingFor = null,
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
        {/* ВЫБОР ПЛОЩАДКИ — обязательный шаг, а не удобство: шаблоны OZON и WB
            несовместимы (у одного артикул и название, у другого только баркод), и
            файл «на обе сразу» ни одна из них не примет. Поэтому одна кнопка со
            списком: менеджер сначала называет площадку, потом получает файл. */}
        {onExportFor && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={exportingFor !== null}>
                <Icon
                  name={exportingFor ? 'Loader2' : 'FileSpreadsheet'}
                  size={16}
                  className={`mr-2 ${exportingFor ? 'animate-spin' : ''}`}
                />
                {exportingFor
                  ? 'Готовим файл...'
                  : pickedCount > 0
                    ? `Файл для площадки (${pickedCount})`
                    : 'Файл для площадки'}
                <Icon name="ChevronDown" size={14} className="ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => onExportFor('ozon')}>
                <Icon name="ShoppingBag" size={16} className="mr-2" />
                Для OZON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExportFor('wb')}>
                <Icon name="ShoppingBag" size={16} className="mr-2" />
                Для Wildberries
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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