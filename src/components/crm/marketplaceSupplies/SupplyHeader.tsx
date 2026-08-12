import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import Icon from '@/components/ui/icon';
import type { SupplyDetail, SupplyStatus } from '@/lib/marketplaceSuppliesApi';
import {
  formatDateTime,
  formatDuration,
  marketplaceLogo,
  statusVariant,
} from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

interface SupplyHeaderProps {
  supply: SupplyDetail;
  isOzonFbo: boolean;
  now: Date;
  /** Режим наблюдения: менеджер видит ход сборки FBS-поставки, но не управляет ею —
   * поставку собирает и закрывает кладовщик на складе. */
  readOnly?: boolean;
  nextStatus: SupplyStatus | undefined;
  nextStatusLabel: Record<string, string>;
  saving: boolean;
  forceCompleting: boolean;
  /** Идёт запрос QR поставки у WB. */
  loadingQr?: boolean;
  onBack: () => void;
  onDelete: () => void;
  onForceComplete: () => void;
  onMoveStatus: () => void;
  onLoadQr?: () => void;
}

const SupplyHeader = ({
  supply,
  isOzonFbo,
  now,
  readOnly = false,
  nextStatus,
  nextStatusLabel,
  saving,
  forceCompleting,
  loadingQr = false,
  onBack,
  onDelete,
  onForceComplete,
  onMoveStatus,
  onLoadQr,
}: SupplyHeaderProps) => {
  // Что именно потеряется при удалении: несшитые заказы уходят вместе с поставкой,
  // а вещи с полок просто освобождаются и остаются на складе.
  const sewingOrders = supply.sewingOrders || [];
  const unsewnCount = sewingOrders.filter((o) => o.sewingStatus === 'Новый').length;
  const fromStockCount = sewingOrders.filter((o) => o.sewingStatus === 'Со склада').length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К списку
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Поставка #{supply.id}</h1>
            {isOzonFbo ? (
              <Badge variant={supply.ozonStatus === 'Сформирована' ? 'default' : 'secondary'}>
                {supply.ozonStatus || 'Заполнение данных'}
              </Badge>
            ) : (
              <Badge className={statusVariant[supply.status]?.className}>{supply.status}</Badge>
            )}
            <span className={marketplaceLogo[supply.marketplace]?.className}>
              {marketplaceLogo[supply.marketplace]?.label || supply.marketplace}
            </span>
            <Badge variant="outline">{supply.type}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Создана {formatDateTime(supply.createdAt)}
            {supply.createdByName && ` — ${supply.createdByName}`}
            {supply.type === 'FBS' && supply.status !== 'Выполнена' && (
              <>
                {' '}
                · на сборке{' '}
                <span className="font-medium text-foreground">{formatDuration(supply.createdAt, now)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {readOnly && (
            <span className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
              <Icon name="Eye" size={16} />
              Наблюдение — поставку собирает кладовщик
            </span>
          )}
          {/* Удаление поставки уносит с собой весь несшитый товарный состав — заказы
              пропадут из конвейера, из вкладки «Новые». Раньше это происходило по одному
              нажатию, без предупреждения. Теперь показываем, что именно исчезнет. */}
          {!readOnly && supply.status === 'Открытая' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Icon name="Trash2" size={16} className="mr-2" />
                  Удалить
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Удалить поставку?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      {unsewnCount > 0 ? (
                        <p>
                          Вместе с поставкой из конвейера удалятся{' '}
                          <b>{unsewnCount} заказов на пошив</b> — они исчезнут из вкладки
                          «Новые». Восстановить их будет нельзя, поставку придётся набирать
                          заново.
                        </p>
                      ) : (
                        <p>
                          Поставка пустая — заказы на пошив по ней не заведены.
                        </p>
                      )}
                      {fromStockCount > 0 && (
                        <p>
                          Вещи, подобранные с полок ({fromStockCount} шт.), вернутся
                          на склад свободными.
                        </p>
                      )}
                      <p>Действие нельзя отменить.</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>
                    Удалить поставку
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!readOnly && supply.type === 'FBS' && supply.status !== 'Выполнена' && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={forceCompleting}>
                  <Icon name="ShieldAlert" size={16} className="mr-2" />
                  Закрыть принудительно
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Закрыть поставку принудительно?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Поставка сразу перейдёт в статус «Выполнена» в нашей системе, все товары будут
                    отмечены отгруженными. Используйте это, если поставка зависла из-за задержек
                    на стороне маркетплейса. Действие нельзя отменить.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction onClick={onForceComplete}>Закрыть принудительно</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!readOnly && nextStatus && (
            <Button onClick={onMoveStatus} disabled={saving}>
              <Icon name="ArrowRight" size={16} className="mr-2" />
              {nextStatusLabel[nextStatus] || nextStatus}
            </Button>
          )}
        </div>
      </div>

      {supply.type === 'FBS' && supply.status === 'Отгрузка' && (
        <Card className="border-border shadow-none">
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div className="flex items-center gap-2 text-sm">
              <Icon name="FileText" size={18} className="text-muted-foreground" />
              <span>Стикер маркетплейса для отгрузки</span>
            </div>
            {supply.marketplace === 'WB' ? (
              // QR поставки приходит от WB сам, когда поставку переводят в доставку.
              // Если WB тогда ответил не сразу — даём кнопку запросить повторно,
              // чтобы кладовщик не искал стикер в кабинете маркетплейса вручную.
              supply.passStickerUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={supply.passStickerUrl} target="_blank" rel="noopener noreferrer">
                    <Icon name="Download" size={14} className="mr-1.5" />
                    Открыть стикер
                  </a>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingQr}
                  onClick={onLoadQr}
                >
                  <Icon name={loadingQr ? 'Loader2' : 'Download'} size={14}
                    className={loadingQr ? 'mr-1.5 animate-spin' : 'mr-1.5'} />
                  {loadingQr ? 'Загружаем…' : 'Загрузить стикер WB'}
                </Button>
              )
            ) : (
              <span className="text-xs text-muted-foreground">
                У OZON FBS нет стикера — только движение товаров по статусам
              </span>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
};

export default SupplyHeader;