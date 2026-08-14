import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Shelf } from '@/lib/shelvesApi';
import type { InspectionStage } from '@/lib/goodsWarehouseApi';

interface ReturnsInspectionActionsProps {
  stage: InspectionStage;
  selected: number[];
  acting: boolean;
  isAdmin: boolean;
  shelves: Shelf[];
  shelfId: string;
  onShelfIdChange: (value: string) => void;
  disposeReason: string;
  onDisposeReasonChange: (value: string) => void;
  onMoveToWorkshop: () => void;
  onToShelf: () => void;
  onDispose: () => void;
  onClear: () => void;
  onClearSelection: () => void;
}

/** Действия по выбранным вещам — свои для каждого этапа. */
const ReturnsInspectionActions = ({
  stage,
  selected,
  acting,
  isAdmin,
  shelves,
  shelfId,
  onShelfIdChange,
  disposeReason,
  onDisposeReasonChange,
  onMoveToWorkshop,
  onToShelf,
  onDispose,
  onClear,
  onClearSelection,
}: ReturnsInspectionActionsProps) => {
  if (selected.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">Выбрано: {selected.length}</span>

      {/* Разбирая привезённое с ПВЗ и принятое ранее, кладовщик отправляет часть
          вещей упаковщицам на осмотр — действие одинаковое для обоих этапов. */}
      {(stage === 'fromReturn' || stage === 'fromMarketplace') && (
        <>
          <Button size="sm" onClick={onMoveToWorkshop} disabled={acting}>
            <Icon name="Truck" size={16} className="mr-2" />
            Переместить в цех на осмотр
          </Button>
          {/* Вещь вернулась в порядке — везти её к упаковщицам незачем. Раньше
              с разбора был один путь, через цех, и годная вещь делала лишний круг
              по производству. Полку выбирают тут же: вещь в руках, и второй заход
              через «Разложить по полкам» не нужен. */}
          <Select value={shelfId} onValueChange={onShelfIdChange}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Полка" />
            </SelectTrigger>
            <SelectContent>
              {shelves.map((sh) => (
                <SelectItem key={sh.id} value={String(sh.id)}>
                  {sh.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={onToShelf}
            disabled={acting || !shelfId}
          >
            <Icon name="Boxes" size={16} className="mr-2" />
            На полку + стикер
          </Button>
        </>
      )}

      {/* Осмотрено: упаковщица уже проверила вещь и наклеила стикер. Кладовщику
          здесь нужно ровно одно — положить на полку. Можно по одной вещи (один
          стикер) или отметить сразу несколько: тогда печатается лента стикеров,
          и рулонный принтер режет её сам. */}
      {stage === 'inspected' && (
        <>
          <Select value={shelfId} onValueChange={onShelfIdChange}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="Полка" />
            </SelectTrigger>
            <SelectContent>
              {shelves.map((sh) => (
                <SelectItem key={sh.id} value={String(sh.id)}>
                  {sh.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={onToShelf} disabled={acting || !shelfId}>
            <Icon name="Boxes" size={16} className="mr-2" />
            {selected.length > 1
              ? `На полку + лента из ${selected.length} стикеров`
              : 'На полку + стикер'}
          </Button>
        </>
      )}

      {/* Утилизация — решение о судьбе товара, а не складская операция. Кладовщик
          её не принимает: на осмотре брак определяет упаковщица в цехе (кнопкой
          на терминале), а окончательно списывает администратор. Раньше кнопка
          стояла на всех этапах, и вещь можно было отправить в утиль со склада
          мимо осмотра — никто потом не мог сказать, кто и почему её забраковал. */}
      {stage !== 'disposed' && stage !== 'toDispose' && isAdmin && (
        <>
          <Input
            value={disposeReason}
            onChange={(e) => onDisposeReasonChange(e.target.value)}
            placeholder="Причина утилизации"
            className="h-9 w-56"
          />
          <Button
            size="sm"
            variant="destructive"
            onClick={onDispose}
            disabled={acting}
          >
            <Icon name="TriangleAlert" size={16} className="mr-2" />
            На утилизацию
          </Button>
        </>
      )}

      {stage === 'toDispose' && isAdmin && (
        <Button size="sm" variant="destructive" onClick={onClear} disabled={acting}>
          <Icon name="Trash2" size={16} className="mr-2" />
          Списать окончательно
        </Button>
      )}

      <Button size="sm" variant="ghost" onClick={onClearSelection}>
        Снять выделение
      </Button>
    </div>
  );
};

export default ReturnsInspectionActions;
