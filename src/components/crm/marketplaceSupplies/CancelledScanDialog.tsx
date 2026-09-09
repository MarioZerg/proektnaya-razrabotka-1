import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { cancelledScanToShelf } from '@/lib/marketplaceSuppliesApi';
import { printStorageSticker } from '@/lib/printStorageSticker';

export interface CancelledScanInfo {
  orderNumber?: string | null;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  storageBarcode?: string | null;
  marketplace?: string | null;
  /** Складская запись вещи — по ней кладём её на полку прямо отсюда. */
  goodsId?: number | null;
  /** Вещь уже возвращена в свободный остаток и ждёт, куда её положить. */
  needsShelf?: boolean;
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
 * Потом окно появилось, но заводило в тупик: оно показывало штрихкод хранения и
 * отправляло кладовщика на склад. А там вещь часто числилась ОТГРУЖЕННОЙ — для
 * таких печать стикера закрыта, и в списке склада их нет вовсе. Человек стоял с
 * вещью в руках и номером, по которому нельзя ничего сделать.
 *
 * Теперь работа заканчивается прямо здесь: сервер уже вернул вещь в свободный
 * остаток, кладовщику остаётся напечатать стикер и выбрать полку.
 */
const CancelledScanDialog = ({ info, onClose }: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);
  /** Полка записана — окно показывает подтверждение вместо кнопок. */
  const [placedOn, setPlacedOn] = useState<string | null>(null);

  // Полки грузим при открытии окна: кладовщик выбирает место, пока вещь в руках.
  useEffect(() => {
    if (!info) return;
    setShelfId('');
    setPlacedOn(null);
    fetchShelves()
      .then(setShelves)
      .catch(() => setShelves([]));
  }, [info]);

  const handlePrint = () => {
    if (!info?.storageBarcode) return;
    printStorageSticker({
      storageBarcode: info.storageBarcode,
      title:
        info.material && info.width && info.height
          ? `${info.material} ${info.width}x${info.height}`
          : info.material,
      orderNumber: info.orderNumber,
    });
  };

  const handlePlace = async () => {
    if (!info?.goodsId || !shelfId) return;
    setSaving(true);
    try {
      const res = await cancelledScanToShelf(info.goodsId, Number(shelfId), {
        id: user?.id,
        name: user?.name,
      });
      setPlacedOn(res.shelfName);
      toast({
        title: `Вещь на полке ${res.shelfName}`,
        description: 'Она снова в свободном остатке — уйдёт под нового покупателя',
      });
    } catch (e) {
      toast({
        title: 'Не удалось положить на полку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
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

          {placedOn ? (
            /* Работа закончена: вещь лежит на полке и снова свободна. */
            <div className="rounded-md border-2 border-emerald-500 bg-emerald-50 p-3 text-emerald-900">
              <p className="flex items-center gap-2 font-semibold">
                <Icon name="CircleCheck" size={18} />
                Положите вещь на полку {placedOn}
              </p>
              <p className="mt-1 text-sm">
                Вещь вернулась в свободный остаток — система подберёт её под нового
                покупателя.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-semibold">В поставку класть НЕЛЬЗЯ</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  На приёмке площадки её не примут. Напечатайте стикер хранения и
                  положите вещь на полку — прямо отсюда, идти на склад не нужно.
                </p>
              </div>

              {/* Печать стикера здесь же. Раньше окно только показывало номер, а
                  на складе кнопка печати для отгруженной вещи была скрыта — и
                  напечатать наклейку было негде. */}
              {info?.storageBarcode && (
                <div className="space-y-2">
                  <p className="text-sm">
                    Штрихкод хранения:{' '}
                    <span className="font-mono-tech font-bold">{info.storageBarcode}</span>
                  </p>
                  <Button variant="outline" className="w-full" onClick={handlePrint}>
                    <Icon name="Barcode" size={16} className="mr-2" />
                    Напечатать стикер хранения
                  </Button>
                </div>
              )}

              {/* Выбор полки: вещь уже свободна, осталось записать её место. */}
              {info?.goodsId && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Куда кладёте?</p>
                  <Select value={shelfId} onValueChange={setShelfId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите полку" />
                    </SelectTrigger>
                    <SelectContent>
                      {shelves.map((sh) => (
                        <SelectItem key={sh.id} value={String(sh.id)}>
                          {sh.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {placedOn ? (
            <Button onClick={onClose} className="w-full">
              Готово, сканирую дальше
            </Button>
          ) : info?.goodsId ? (
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Позже
              </Button>
              <Button
                className="flex-1"
                onClick={handlePlace}
                disabled={!shelfId || saving}
              >
                {saving ? 'Сохраняем…' : 'Положил на полку'}
              </Button>
            </div>
          ) : (
            <Button onClick={onClose} className="w-full">
              Понятно, отложил
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CancelledScanDialog;
