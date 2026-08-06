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
  onBack: () => void;
  onDelete: () => void;
  onForceComplete: () => void;
  onMoveStatus: () => void;
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
  onBack,
  onDelete,
  onForceComplete,
  onMoveStatus,
}: SupplyHeaderProps) => {
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
          {!readOnly && supply.status === 'Открытая' && (
            <Button variant="destructive" onClick={onDelete}>
              <Icon name="Trash2" size={16} className="mr-2" />
              Удалить
            </Button>
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
              <Button variant="outline" size="sm" disabled>
                <Icon name="Download" size={14} className="mr-1.5" />
                Подгрузится после подключения API
              </Button>
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
