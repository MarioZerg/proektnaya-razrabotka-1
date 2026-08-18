import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { GoodsCard as GoodsCardType } from '@/lib/goodsWarehouseApi';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import type { NotFoundTarget } from '@/components/crm/goodsWarehouse/NotFoundDialog';

interface GoodsCardActionsProps {
  card: GoodsCardType;
  isAdmin: boolean;
  labeled: boolean;
  isFbo: boolean;
  schemeLabel: string;
  alreadyInSupply: boolean;
  canPrintLabel: boolean;
  printing: boolean;
  sending: boolean;
  onPrint: () => void;
  onSendToSupply: () => void;
  onRestore: () => void;
  onSendToSewing: (item: GoodsWarehouseItem) => void;
  onNotFound: (item: NotFoundTarget) => void;
}

/**
 * Действия по вещи: возврат списанной, печать стикера, отправка на поставку
 * и «плохие» исходы (в пошив / не найден).
 */
const GoodsCardActions = ({
  card,
  isAdmin,
  labeled,
  isFbo,
  schemeLabel,
  alreadyInSupply,
  canPrintLabel,
  printing,
  sending,
  onPrint,
  onSendToSupply,
  onRestore,
  onSendToSewing,
  onNotFound,
}: GoodsCardActionsProps) => (
  <>
    {/* Вещь была списана (не нашли на складе или брак), но потом нашлась.
        Раньше это был тупик: запись оставалась мёртвой навсегда, вещь заводили
        заново с новым стикером, а история движения обрывалась. Теперь админ
        возвращает её на полку одной кнопкой — со всей прежней историей. */}
    {card.status === 'lost' && (
      <Card className="border-emerald-300 bg-emerald-50 shadow-none">
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-start gap-2.5">
            <Icon name="PackageSearch" size={20} className="mt-0.5 text-emerald-700" />
            <div>
              <p className="font-semibold text-emerald-900">Товар списан со склада</p>
              <p className="text-sm text-emerald-800">
                {card.lostReason || 'Причина не указана'}
              </p>
            </div>
          </div>
          {isAdmin ? (
            <Button onClick={onRestore}>
              <Icon name="PackageCheck" size={18} className="mr-2" />
              Товар нашёлся — вернуть на полку
            </Button>
          ) : (
            <p className="text-sm text-emerald-800">
              Если вещь нашлась, вернуть её на склад может администратор.
            </p>
          )}
        </CardContent>
      </Card>
    )}

    {/* Действия по порядку: сначала стикер (FBS или FBO — по схеме заказа),
        потом отправка на поставку. Для списанной вещи этот блок не нужен:
        её сначала возвращают на полку. */}
    {card.status !== 'lost' && (
      <Card className="border-primary/30 bg-primary/5 shadow-none">
        <CardContent className="space-y-3 pt-6">
          {alreadyInSupply ? (
            <div className="flex items-center gap-2.5">
              <Icon name="CircleCheck" size={20} className="text-emerald-600" />
              <div>
                <p className="font-semibold">Вещь на поставке</p>
                <p className="text-sm text-muted-foreground">
                  {card.supplyId
                    ? `Добавлена в поставку №${card.supplyId}`
                    : `Ждёт сканирования в короб поставки ${schemeLabel} ${
                        card.reservedMarketplace || ''
                      }`.trim()}
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm font-medium">
                {labeled
                  ? 'Стикер готов — отправьте вещь на поставку'
                  : `Напечатайте стикер ${schemeLabel} и наклейте его на вещь`}
              </p>
              {isFbo && (
                // Кладовщик должен понимать, ЧТО он печатает: на FBO-стикере код
                // товара, по нему вещь принимают на складе маркетплейса.
                <p className="text-xs text-muted-foreground">
                  Это FBO: печатается складской стикер с кодом товара — вещь поедет
                  коробкой на склад маркетплейса.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  onClick={onPrint}
                  disabled={printing || !canPrintLabel}
                  variant={labeled ? 'outline' : 'default'}
                >
                  <Icon
                    name={printing ? 'Loader2' : 'Printer'}
                    size={18}
                    className={`mr-2 ${printing ? 'animate-spin' : ''}`}
                  />
                  {labeled ? 'Напечатать ещё раз' : `Напечатать стикер ${schemeLabel}`}
                </Button>
                {labeled && (
                  <Button size="lg" onClick={onSendToSupply} disabled={sending}>
                    <Icon
                      name={sending ? 'Loader2' : 'Truck'}
                      size={18}
                      className={`mr-2 ${sending ? 'animate-spin' : ''}`}
                    />
                    Отправить на поставку
                  </Button>
                )}
              </div>
              {!canPrintLabel && (
                <p className="text-sm text-muted-foreground">
                  {card.reservedOrderId
                    ? 'Вещь лежит на хранении — стикер отправления печатают только при сборке под заказ'
                    : 'Вещь пока не подобрана под заказ — стикер печатать не из чего'}
                </p>
              )}

              {/* Оба «плохих» исхода по вещи — в одном меню.
                  Раньше «Отправить в пошив» жила здесь, а «Не нашёл» дублировалась
                  в строке списка: две кнопки в разных местах про одно и то же
                  решение — вещь со склада уходит, заказ едет шиться заново.
                  Теперь выбор делается один раз и в одном месте. */}
              <div className="border-t border-border pt-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Icon name="Settings2" size={18} className="mr-2" />
                      Действия с товаром
                      <Icon name="ChevronDown" size={16} className="ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuItem
                      onClick={() =>
                        onSendToSewing({
                          id: card.id,
                          product: card.product,
                          orderNumber: card.reservedOrderNumber || card.sourceOrderNumber,
                          storageBarcode: card.storageBarcode,
                        } as GoodsWarehouseItem)
                      }
                    >
                      <Icon name="Shirt" size={16} className="mr-2" />
                      Отправить в пошив
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        onNotFound({
                          id: card.id,
                          title: card.product || 'Товар',
                          orderNumber: card.reservedOrderNumber || card.sourceOrderNumber,
                          storageBarcode: card.storageBarcode,
                          shelfName: card.shelfName,
                        })
                      }
                    >
                      <Icon name="SearchX" size={16} className="mr-2" />
                      Товар не найден
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  В обоих случаях вещь спишется со склада, а заказ вернётся на конвейер
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    )}
  </>
);

export default GoodsCardActions;
