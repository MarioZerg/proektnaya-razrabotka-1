import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import PlaceInspectedBody from '@/components/crm/goodsWarehouse/PlaceInspectedBody';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import type { Shelf } from '@/lib/shelvesApi';
import { placeOnShelf, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

interface PlaceOnShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelves: Shelf[];
  /** Вещи, забранные из цеха, но ещё не разложенные по полкам.
   *
   * Именно вещи, а не их количество: раньше кладовщик видел только цифру «ждут укладки: 7»
   * и шёл в цех вслепую — какая ткань, какой размер, от какого заказа, непонятно.
   * Найти нужное среди похожих вещей по одному числу невозможно. */
  pendingItems: GoodsWarehouseItem[];
  onDone: () => void;
  /** Сколько осмотренных вещей ждут укладки — цифра на второй вкладке. */
  inspectedReady?: number;
  /** Пересчитать счётчик осмотренных после укладки. */
  onInspectedDone?: () => void;
  /** С какой вкладки открыть окно: кладовщик жмёт разные кнопки. */
  initialTab?: 'cancelled' | 'inspected';
}

/** Кладовщик забрал из цеха вещи, отменённые клиентом (упаковщик наклеил стикер хранения),
 * и раскладывает их по полкам: выбирает полку один раз и сканирует стикеры один за другим. */
const PlaceOnShelfDialog = ({
  open,
  onOpenChange,
  shelves,
  pendingItems,
  onDone,
  inspectedReady = 0,
  onInspectedDone,
  initialTab = 'inspected',
}: PlaceOnShelfDialogProps) => {
  const pendingCount = pendingItems.length;
  const { toast } = useToast();
  // Какая вкладка открыта. Осмотренные из цеха — вторым уровнем здесь же:
  // кладовщик стоит у одного стеллажа с одним сканером и делает оба дела подряд.
  const [tab, setTab] = useState<string>(initialTab);

  // Открыли окно — показываем ту вкладку, кнопку которой нажали.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  const [barcode, setBarcode] = useState('');
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);
  const [placed, setPlaced] = useState<string[]>([]);

  // Сменили полку — начинаем счёт заново.
  //
  // Список подписан текущей полкой («Положено на "Верхняя": 5»), но раньше он копил
  // вещи со всех полок подряд. Кладовщик раскладывал пять штук на одну полку,
  // переключался на другую — и видел «Положено на "Нижняя": 5», хотя туда не положил
  // ещё ничего. Пересчитывать приходилось руками.
  useEffect(() => {
    setPlaced([]);
  }, [shelfId]);

  const handleSave = async () => {
    if (!barcode.trim() || !shelfId) return;
    setSaving(true);
    try {
      const scanned = barcode.trim();
      const res = await placeOnShelf(scanned, Number(shelfId));
      // Подписываем положенную вещь тканью и размером — по названию товара их не
      // различить, а кладовщику важно видеть, что именно он сейчас убрал на полку.
      const item = pendingItems.find((i) => i.storageBarcode === scanned);
      const title =
        item && item.material && item.width && item.height
          ? `${item.material} ${item.width}×${item.height}`
          : res.product || '';
      setPlaced((prev) =>
        [[res.orderNumber, title].filter(Boolean).join(' · '), ...prev].slice(0, 8)
      );
      setBarcode('');
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось положить на полку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setBarcode('');
    } finally {
      setSaving(false);
    }
  };

  useScannerAutoSubmit(barcode, handleSave, !!shelfId && !saving);

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setBarcode('');
          setPlaced([]);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Принять осмотренные из цеха</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          {/* Осмотренные из цеха — первыми: это основная ежедневная работа
              кладовщика у стеллажа. Отменённые клиентом приходят реже. */}
          <TabsList className="w-full">
            <TabsTrigger value="inspected" className="flex-1">
              Принять осмотренные из цеха
              {inspectedReady > 0 && ` (${inspectedReady})`}
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="flex-1">
              Разложить по полкам
              {pendingCount > 0 && ` (${pendingCount})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cancelled" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ждут укладки: <span className="font-semibold text-foreground">{pendingCount}</span>.
            Выберите полку и сканируйте стикеры хранения один за другим.
          </p>

          {/* Что именно нужно забрать из цеха: ткань, размер, номер заказа и стикер
              хранения. Без этого списка кладовщик шёл к упаковщицам с одной цифрой
              и не мог отличить нужную вещь от десятка похожих. */}
          {pendingCount > 0 && (
            <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
              <p className="text-sm font-medium">Забрать из цеха</p>
              {pendingItems.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">
                      {[i.material, i.width && i.height ? `${i.width}×${i.height}` : null]
                        .filter(Boolean)
                        .join(' ') || i.product || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Отменён клиентом
                      {i.orderNumber ? ` · заказ ${i.orderNumber}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono-tech text-xs text-muted-foreground">
                    {i.storageBarcode}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Полка</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите полку" />
              </SelectTrigger>
              <SelectContent>
                {shelves.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Стикер хранения</Label>
            <Input
              autoFocus
              disabled={!shelfId}
              placeholder={shelfId ? 'Отсканируйте стикер' : 'Сначала выберите полку'}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className="font-mono-tech"
            />
          </div>

          {placed.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-medium">
                Положено на «{shelfName}»: {placed.length}
              </p>
              {placed.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon name="Check" size={14} className="text-emerald-600" />
                  {p}
                </div>
              ))}
            </div>
          )}

          {pendingCount === 0 && placed.length === 0 && (
            <Badge variant="secondary" className="w-full justify-center py-2">
              Все отменённые товары разложены
            </Badge>
          )}
          </TabsContent>

          {/* Вещи, которые ездили в цех на осмотр и вернулись проверенными. */}
          <TabsContent value="inspected">
            <PlaceInspectedBody
              active={open && tab === 'inspected'}
              onClose={() => onOpenChange(false)}
              onDone={() => {
                onDone();
                onInspectedDone?.();
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default PlaceOnShelfDialog;