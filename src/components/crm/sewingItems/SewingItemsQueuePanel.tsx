import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import NextStackHint from '@/components/crm/sewingItems/NextStackHint';

interface SewingItemsQueuePanelProps {
  isCutter: boolean;
  isSewer: boolean;
  effectiveWorkshopId: number | null;
  lastTakenStack: unknown[];
  takingStack: boolean;
  myUnfinishedCount: number;
  cutterLimit: number;
  printQrCuttingEnabled: boolean;
  handleTakeStack: (single?: boolean) => void;
  handlePrintTask: () => void;
  takingOrder: boolean;
  takeOrderCooldown: boolean;
  takeLocked: boolean;
  inWork: number;
  maxOrders: number;
  handleTakeOrder: () => void;
  myInWorkCount: number;
  myGroups: { groupKey: string; total: number; done: number }[];
}

/** Кнопки очереди для закройщика и швеи: взять стек, добрать заказ, получить вещь. */
const SewingItemsQueuePanel = ({
  isCutter,
  isSewer,
  effectiveWorkshopId,
  lastTakenStack,
  takingStack,
  myUnfinishedCount,
  cutterLimit,
  printQrCuttingEnabled,
  handleTakeStack,
  handlePrintTask,
  takingOrder,
  takeOrderCooldown,
  takeLocked,
  inWork,
  maxOrders,
  handleTakeOrder,
  myInWorkCount,
  myGroups,
}: SewingItemsQueuePanelProps) => {
  if (!isCutter && !isSewer) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* Что сейчас первое в общей очереди цеха — связка или обычный стек. */}
      {isCutter && (
        <NextStackHint
          workshopId={effectiveWorkshopId}
          refreshKey={lastTakenStack.length}
        />
      )}
      {isCutter && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => handleTakeStack()} disabled={takingStack || myUnfinishedCount > 0} className="w-full sm:w-auto">
            {takingStack ? (
              <>
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                Берём заказы...
              </>
            ) : (
              <>
                <Icon name="Layers" size={16} className="mr-2" />
                Взять стек заказов
              </>
            )}
          </Button>
          {/* Добор одной вещи ДО предела заказов на руках.
              Раньше кнопка запиралась любым незакрытым заказом: взял стек,
              раскроил половину — и добрать вещь под остаток рулона уже
              нельзя. Теперь можно добирать, пока на руках меньше лимита.
              Связки Яндекса сюда не попадают — заказ из нескольких вещей
              раскраивается только целиком, придёт следующий одиночный. */}
          <Button
            variant="outline"
            onClick={() => handleTakeStack(true)}
            disabled={takingStack || myUnfinishedCount >= cutterLimit}
            className="w-full sm:w-auto"
            title={
              myUnfinishedCount >= cutterLimit
                ? `На руках ${myUnfinishedCount} из ${cutterLimit} — раскроите часть`
                : undefined
            }
          >
            <Icon name="Plus" size={16} className="mr-2" />
            Взять 1 заказ
            {myUnfinishedCount > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {myUnfinishedCount}/{cutterLimit}
              </span>
            )}
          </Button>
          {/* Кнопка живёт, пока есть нераскроенные заказы — это данные с сервера.
              Раньше она зависела от памяти браузера: закройщица обновляла страницу
              или заходила с другого планшета, и кнопка пропадала вместе с
              возможностью распечатать лист по уже взятому стеку. */}
          {printQrCuttingEnabled && (myUnfinishedCount > 0 || lastTakenStack.length > 0) && (
            <Button variant="outline" onClick={handlePrintTask} className="w-full sm:w-auto">
              <Icon name="Printer" size={16} className="mr-2" />
              Распечатать задание
            </Button>
          )}
        </div>
      )}
      {/* ЗАМОЧЕК НА КНОПКЕ, когда на руках предельное число заказов.
          Считается только «В работе»: сдала вещь на стикеровку — замок снялся
          сразу, ждать упаковщицу не нужно. Темп внутри лимита задаёт таймер
          пошива на кнопке каждой вещи. */}
      {isSewer && (
        <Button
          onClick={handleTakeOrder}
          disabled={takingOrder || takeOrderCooldown || takeLocked}
          className="w-full sm:w-auto"
        >
          {takingOrder ? (
            <>
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              Получаем заказ...
            </>
          ) : takeLocked ? (
            <>
              <Icon name="Lock" size={16} className="mr-2" />
              В работе {inWork} из {maxOrders}
            </>
          ) : (
            <>
              <Icon name="PackagePlus" size={16} className="mr-2" />
              Получить новый заказ
            </>
          )}
        </Button>
      )}

      {isSewer && takeLocked && (
        <p className="text-sm text-muted-foreground">
          Отправьте хотя бы один заказ на стикеровку — кнопка откроется сразу.
        </p>
      )}

      {isCutter && myUnfinishedCount > 0 && (
        <p className="text-sm text-muted-foreground">
          У вас {myUnfinishedCount} нераскроенных заказов — раскроите их, прежде чем брать новый стек.
        </p>
      )}

      {isSewer && myInWorkCount > 0 && (
        <p className="text-sm text-muted-foreground">
          У вас {myInWorkCount} заказов в работе — укажите рулон тесьмы и отправьте их на стикеровку.
        </p>
      )}

      {/* Связки Яндекса в работе у швеи: заказ покупателя шьётся целиком одним
          человеком, поэтому показываем прогресс — сколько вещей заказа уже отшито. */}
      {isSewer &&
        myGroups.map((g) => (
          <div
            key={g.groupKey}
            className="flex flex-wrap items-center gap-2 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm text-violet-900"
          >
            <Icon name="Package" size={16} />
            <span className="font-semibold">Заказ покупателя целиком</span>
            <span className="break-all font-mono-tech text-xs">{g.groupKey}</span>
            <Badge className="bg-violet-600 text-white hover:bg-violet-600">
              отшито {g.done} из {g.total}
            </Badge>
          </div>
        ))}
    </div>
  );
};

export default SewingItemsQueuePanel;
