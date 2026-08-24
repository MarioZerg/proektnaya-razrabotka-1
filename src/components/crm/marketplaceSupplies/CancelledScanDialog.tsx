import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';

export interface CancelledScanInfo {
  orderNumber?: string | null;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  storageBarcode?: string | null;
  marketplace?: string | null;
}

interface Props {
  info: CancelledScanInfo | null;
  onClose: () => void;
}

/**
 * Отсканирована вещь ОТМЕНЁННОГО заказа.
 *
 * Раньше отмену при сборке поставки не показывали вовсе: кладовщик клал вещь в
 * короб, она уезжала на площадку, там её не принимали — и она возвращалась назад
 * через возвратный цикл. Недели пути и лишние расходы из-за одной наклейки.
 *
 * Теперь скан такой вещи звучит отдельным сигналом «отбой» и останавливает
 * работу этим окном: видно, что за вещь в руках и куда её деть — на полку
 * хранения, а не в поставку.
 */
const CancelledScanDialog = ({ info, onClose }: Props) => (
  <Dialog open={!!info} onOpenChange={(v) => !v && onClose()}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-destructive">
          <Icon name="CircleX" size={22} />
          Заказ отменён покупателем
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-3">
        <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3">
          <p className="text-xs text-muted-foreground">Вещь у вас в руках</p>
          <p className="mt-1 text-lg font-bold">
            {info?.material || 'Товар'}{' '}
            {info?.width && info?.height ? `${info.width}×${info.height}` : ''}
          </p>
          <p className="font-mono-tech text-sm text-muted-foreground">
            {info?.orderNumber || '—'}
          </p>
        </div>

        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-semibold">В поставку класть НЕЛЬЗЯ</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Отложите вещь и передайте на склад хранения — на приёмке площадки её
            не примут, и она поедет обратно.
          </p>
          {info?.storageBarcode && (
            <p className="mt-2 text-sm">
              Штрихкод хранения:{' '}
              <span className="font-mono-tech font-bold">{info.storageBarcode}</span>
            </p>
          )}
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onClose} className="w-full">
          Понятно, отложил
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export default CancelledScanDialog;
