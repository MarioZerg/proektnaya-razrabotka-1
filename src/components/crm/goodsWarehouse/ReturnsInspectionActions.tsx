import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  /** Сколько среди выбранных вещей — отмена после стикеровки в цехе. Такие идут
   * только на полку, утилизация для них недоступна. */
  cancelledLabeledCount?: number;
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
  cancelledLabeledCount = 0,
}: ReturnsInspectionActionsProps) => {
  // Отправка в цех — действие в один клик и на всю выделенную пачку сразу.
  // Обратной кнопки у неё нет: вещи уезжают к упаковщицам, и вернуть их
  // может только администратор. Один промах мышью — и три десятка возвратов
  // уходят не туда (так и случилось 05.09: 30 вещей улетели в цех разом).
  // Поэтому спрашиваем подтверждение и показываем ЧИСЛО вещей.
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (selected.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">Выбрано: {selected.length}</span>

      {/* Разбирая привезённое с ПВЗ и принятое ранее, кладовщик отправляет часть
          вещей упаковщицам на осмотр — действие одинаковое для обоих этапов. */}
      {(stage === 'fromReturn' || stage === 'fromMarketplace') && (
        <>
          {/* ОТМЕНА ПОСЛЕ СТИКЕРОВКИ В ЦЕХ НЕ ЕДЕТ — она оттуда и пришла.
              Вещь упаковала та же упаковщица десять минут назад, осматривать ей
              нечего. Отправить такую «на осмотр» — вернуть вещь туда, откуда её
              только что принесли, и потерять день на пустой круг. */}
          {cancelledLabeledCount === 0 && (
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={acting}>
              <Icon name="Truck" size={16} className="mr-2" />
              Переместить в цех на осмотр
            </Button>
          )}

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Передать в цех {selected.length}{' '}
                  {selected.length === 1 ? 'вещь' : selected.length < 5 ? 'вещи' : 'вещей'}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Вещи уедут упаковщицам на осмотр и пропадут из вашего разбора
                  возвратов. Вернуть их обратно сможет только администратор —
                  проверьте, что выбрали именно то, что везёте в цех.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction onClick={onMoveToWorkshop}>
                  Да, передать в цех
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
      {/* ОТМЕНА ПОСЛЕ СТИКЕРОВКИ В ЦЕХЕ — утилизации у неё нет.
          Вещь сшили, упаковали и заклеили ярлыком, и только потом покупатель отменил
          заказ. К нему она не уезжала, брака взяться неоткуда — путь один: полка со
          стикером хранения, откуда её подберут под следующий заказ. Кнопку не просто
          гасим, а убираем совсем: серая кнопка заставляет гадать, почему не работает. */}
      {stage !== 'disposed' &&
        stage !== 'toDispose' &&
        isAdmin &&
        cancelledLabeledCount === 0 && (
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

      {/* Подсказка вместо спрятанных кнопок — видна ВСЕМ, а не только админу:
          кнопку «в цех на осмотр» нажимает кладовщик, и объяснить пропажу нужно
          прежде всего ему. Иначе он ищет исчезнувшую кнопку и зовёт разбираться. */}
      {stage !== 'disposed' && stage !== 'toDispose' && cancelledLabeledCount > 0 && (
        <span className="text-sm text-sky-700">
          {cancelledLabeledCount === selected.length
            ? 'Отмена после стикеровки — вещь из цеха, осмотр не нужен: только на полку со стикером хранения'
            : `Среди выбранных ${cancelledLabeledCount} шт. отменённых после стикеровки — они идут только на полку`}
        </span>
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