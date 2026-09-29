import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';

interface GoodsPickingHeaderProps {
  /** Возврат к складу товара. */
  onBack: () => void;
  /** Открыть сканер подбора. */
  onScan: () => void;
  /** Пересчитать подбор по всему складу. */
  onRematch: () => void;
  rematching: boolean;
  /** Перечитать список заказов. */
  onReload: () => void;
  loading: boolean;
}

/** Шапка страницы «Товар к подбору»: возврат к складу, заголовок и кнопки действий. */
const GoodsPickingHeader = ({
  onBack,
  onScan,
  onRematch,
  rematching,
  onReload,
  loading,
}: GoodsPickingHeaderProps) => {
  const busyLabel = rematching ? 'Пересчитываем подбор...' : loading ? 'Обновляем...' : null;

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-2">
        <Icon name="ChevronLeft" size={16} className="mr-1" />
        К складу товара
      </Button>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Товар к подбору</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Вещи, подобранные под заказы: заберите с полки и наклейте стикер
          </p>
        </div>
        {/* Раньше сканер, пересчёт и обновление стояли в ряд и на узком экране
            выталкивали заголовок. Теперь это один список. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Icon
                name={busyLabel ? 'Loader2' : 'Ellipsis'}
                size={16}
                className={`mr-2 ${busyLabel ? 'animate-spin' : ''}`}
              />
              {busyLabel || 'Действия'}
              <Icon name="ChevronDown" size={14} className="ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* Сканер подбора: отсканировал вещь с полки — сразу печать стикера. */}
            <DropdownMenuItem onClick={onScan}>
              <Icon name="ScanLine" size={16} className="mr-2" />
              Сканер подбора
            </DropdownMenuItem>
            {/* Заказы из загруженной заявки FBO приходят пачкой и в подбор сами не
                встают: подбор запускается, когда вещь КЛАДУТ на полку, а тут наоборот —
                вещи давно лежат, а заказы появились после. Пункт сверяет остаток
                с новыми заказами, чтобы готовый товар не ушёл шиться заново. */}
            <DropdownMenuItem onClick={onRematch} disabled={rematching}>
              <Icon
                name={rematching ? 'Loader2' : 'Wand2'}
                size={16}
                className={`mr-2 ${rematching ? 'animate-spin' : ''}`}
              />
              {rematching ? 'Пересчитываем...' : 'Пересчитать подбор'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReload} disabled={loading}>
              <Icon
                name={loading ? 'Loader2' : 'RefreshCw'}
                size={16}
                className={`mr-2 ${loading ? 'animate-spin' : ''}`}
              />
              {loading ? 'Обновляем...' : 'Обновить'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default GoodsPickingHeader;
