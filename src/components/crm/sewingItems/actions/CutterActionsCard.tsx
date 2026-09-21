import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import type { Roll } from '@/lib/rollsApi';
import { hangerLabel, type Hanger } from '@/lib/hangersApi';
import { isOrderCancelled } from '@/components/crm/sewingItems/sewingItemsShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface CutterActionsCardProps {
  selectedOrder: Order;
  orderDetail: OrderDetail | null;
  cutting: boolean;
  canCut: boolean;
  isAlreadyCut: boolean;
  matchingRolls: Roll[];
  selectedRollId: string;
  setSelectedRollId: (value: string) => void;
  hangers: Hanger[];
  selectedHanger: string;
  setSelectedHanger: (value: string) => void;
  onCut: (rollId?: number, hangerNumber?: number) => void;
  onCutGroup: (rollId?: number, hangerNumber?: number) => void;
  /** Ткань взята с перешива: рулон не выбираем и не списываем. */
  repairPieceTaken?: boolean;
}

/** Блок раскроя: выбор рулона тюля, вешалки и кнопки «Раскроено» / «Раскроить всю связку». */
const CutterActionsCard = ({
  selectedOrder,
  orderDetail,
  cutting,
  canCut,
  isAlreadyCut,
  matchingRolls,
  selectedRollId,
  setSelectedRollId,
  hangers,
  selectedHanger,
  setSelectedHanger,
  onCut,
  onCutGroup,
  repairPieceTaken = false,
}: CutterActionsCardProps) => {
  // Заказ уже ушёл дальше по конвейеру — раскраивать нечего, показываем причину,
  // а не молча заблокированные поля.
  if (!canCut) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Icon name="Info" size={16} />
          Заказ уже в статусе «{selectedOrder?.sewingStatus}» — раскрой завершён, рулон и
          вешалку изменить нельзя.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-none">
      {/* ЗАКАЗ ОТМЕНИЛИ, НО ОН УЖЕ У ЗАКРОЙЩИЦЫ В СТЕКЕ — ДОВОДИМ ДО КОНЦА.
          Раньше здесь стояла заглушка «раскраивать не нужно», и раскрой был
          закрыт: закройщица не могла отправить вещь в «Раскроено» и сбрасывала
          её обратно в «Новый». Там отменённый заказ скрывается из очереди —
          вещь повисала на вешалке, и взять её в работу не мог уже никто.
          Именно так завис заказ 40863907-0422-1.
          Теперь порядок один на все отмены: вещь проходит конвейер целиком и
          на стикеровке получает складской стикер GW вместо ярлыка покупателя. */}
      {isOrderCancelled(selectedOrder) && (
        <CardContent className="space-y-1.5 border-b border-red-200 bg-red-50 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-red-800">
            <Icon name="XCircle" size={16} className="shrink-0" />
            Покупатель отменил заказ — доводим вещь до конца
          </p>
          <p className="text-sm text-red-900">
            Раскраивайте и передавайте дальше как обычно. На стикеровке вещь
            получит складской стикер и уедет на полку хранения — ярлыка
            покупателя у неё не будет. В «Новый» не возвращайте: оттуда
            отменённый заказ уже никто не сможет взять.
          </p>
        </CardContent>
      )}
      <CardHeader className="pb-3">
        <CardTitle className="break-words text-sm">
          {repairPieceTaken ? 'Раскрой куском с перешива' : 'Выбор рулона тюля'}
          {!repairPieceTaken && orderDetail?.requiredFabricMaterialName && (
            <span className="ml-1 font-normal text-muted-foreground">
              — нужен материал «{orderDetail.requiredFabricMaterialName}»
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        {/* РУЛОНЫ ПРЯЧЕМ, КОГДА ТКАНЬ ВЗЯТА С ПЕРЕШИВА.
            Отрез уже закреплён за вещью и лежит на столе. Оставлять рядом
            список рулонов нельзя: закройщица выберет рулон «до кучи», и заказ
            съест материал дважды — метры спишутся с рулона, хотя резали кусок.
            Блокировать поле мало, его надо убрать: выбор должен быть один.
            Чтобы снова резать от рулона, кусок откреплеяют в блоке выше. */}
        {repairPieceTaken ? (
          <div className="w-full rounded-md border border-violet-200 bg-violet-50 p-2.5 text-sm text-violet-900">
            Рулон выбирать не нужно — вещь кроится из куска с перешива. Чтобы взять
            рулон, откре́пите кусок в блоке выше: он вернётся в перешив.
          </div>
        ) : (
          <div className="w-full space-y-1.5 sm:w-64">
            <Label>Рулон в вашем цехе/смене</Label>
            <Select value={selectedRollId} onValueChange={setSelectedRollId} disabled={cutting || isAlreadyCut}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите рулон" />
              </SelectTrigger>
              <SelectContent>
                {matchingRolls.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                ) : (
                  matchingRolls.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {/* Пустой список — тупик: закройщик не понимает, почему нельзя раскроить.
                Называем нужную ткань, чтобы было с чем идти к кладовщику. */}
            {matchingRolls.length === 0 && (
              <p className="text-xs text-amber-700">
                В вашем цехе и смене нет рулонов
                {orderDetail?.requiredFabricMaterialName
                  ? ` «${orderDetail.requiredFabricMaterialName}»`
                  : ' нужной ткани'}
                . Попросите кладовщика передать рулон в цех.
              </p>
            )}
          </div>
        )}

        <div className="w-40 space-y-1.5">
          <Label>Вешалка</Label>
          <Select value={selectedHanger} onValueChange={setSelectedHanger} disabled={cutting || isAlreadyCut}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите вешалку" />
            </SelectTrigger>
            <SelectContent>
              {hangers.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет вешалок</div>
              ) : (
                hangers.map((h) => (
                  <SelectItem key={h.id} value={String(h.number)}>
                    {hangerLabel(h)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={() =>
            onCut(
              selectedRollId ? Number(selectedRollId) : undefined,
              selectedHanger ? Number(selectedHanger) : undefined
            )
          }
          disabled={cutting || isAlreadyCut || (!selectedRollId && !repairPieceTaken)}
        >
          {cutting ? (
            <>
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              Списываем материалы...
            </>
          ) : (
            <>
              <Icon name="Scissors" size={16} className="mr-2" />
              Раскроено
            </>
          )}
        </Button>

        {/* Заказ Яндекса из нескольких вещей отправляем в цех ЦЕЛИКОМ одной кнопкой: иначе
            заказ из 30 вещей пришлось бы раскраивать 30 нажатиями, а швея потом собирала бы
            его по кусочкам. Связка вешается вместе — её берёт одна швея. */}
        {/* Кусок с перешива закреплён за ОДНОЙ вещью — на всю связку его не хватит:
            остальные вещи нужно резать от рулона, а рулон здесь не выбран.
            Поэтому кнопку связки прячем, вещь раскраивается отдельно. */}
        {!repairPieceTaken && selectedOrder.groupSize && selectedOrder.groupSize > 1 && (
          <Button
            variant="outline"
            className="border-violet-500 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
            onClick={() =>
              onCutGroup(
                selectedRollId ? Number(selectedRollId) : undefined,
                selectedHanger ? Number(selectedHanger) : undefined
              )
            }
            disabled={cutting || !selectedRollId}
          >
            <Icon name="Package" size={16} className="mr-2" />
            Раскроить всю связку — {selectedOrder.groupSize} вещей
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default CutterActionsCard;