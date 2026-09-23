import { Button } from '@/components/ui/button';
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
}: GoodsPickingHeaderProps) => (
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
      <div className="flex gap-2">
        {/* Сканер подбора: отсканировал вещь с полки — сразу печать стикера. */}
        <Button onClick={onScan}>
          <Icon name="ScanLine" size={16} className="mr-2" />
          Сканер подбора
        </Button>
        {/* Заказы из загруженной заявки FBO приходят пачкой и в подбор сами не
            встают: подбор запускается, когда вещь КЛАДУТ на полку, а тут наоборот —
            вещи давно лежат, а заказы появились после. Кнопка сверяет остаток
            с новыми заказами, чтобы готовый товар не ушёл шиться заново. */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRematch}
          disabled={rematching}
          title="Сверить свободный остаток склада с новыми заказами"
        >
          <Icon
            name={rematching ? 'Loader2' : 'Wand2'}
            size={14}
            className={`mr-1.5 ${rematching ? 'animate-spin' : ''}`}
          />
          Пересчитать подбор
        </Button>
        <Button variant="outline" size="sm" onClick={onReload} disabled={loading}>
          <Icon
            name={loading ? 'Loader2' : 'RefreshCw'}
            size={14}
            className={`mr-1.5 ${loading ? 'animate-spin' : ''}`}
          />
          Обновить
        </Button>
      </div>
    </div>
  </div>
);

export default GoodsPickingHeader;
