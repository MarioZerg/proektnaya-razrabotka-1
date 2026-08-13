import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printDisposeSticker } from '@/lib/printDisposeSticker';
import { fetchRepackItems, finishRepack, type RepackItem } from '@/lib/kioskApi';

interface KioskRepackScreenProps {
  actorId: number;
  actorName: string;
}

/** Перепаковка: вещи вернулись от покупателя. Упаковщик вскрывает пакет, осматривает вещь
 * и решает — переупаковать (печатает стикер хранения, вещь едет на склад) или списать,
 * если внутри обнаружился брак. */
const KioskRepackScreen = ({ actorId, actorName }: KioskRepackScreenProps) => {
  const { toast } = useToast();
  const [items, setItems] = useState<RepackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  // Вещь, по которой упаковщица нажала «Переупаковано»: спрашиваем про новый пакет,
  // прежде чем закрыть перепаковку и напечатать стикер.
  const [bagAskItem, setBagAskItem] = useState<RepackItem | null>(null);

  const load = () => {
    setLoading(true);
    fetchRepackItems()
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleFinish = async (
    item: RepackItem,
    outcome: 'repacked' | 'utilized',
    newBag?: boolean,
  ) => {
    const note = (notes[item.id] || '').trim();
    if (outcome === 'utilized' && !note) {
      toast({
        title: 'Опишите брак',
        description: 'Администратор должен видеть, за что списан товар',
        variant: 'destructive',
      });
      return;
    }
    setProcessingId(item.id);
    setBagAskItem(null);
    try {
      const res = await finishRepack({ id: item.id, outcome, newBag, note, actorId, actorName });

      if (outcome === 'repacked' && res.storageBarcode) {
        // Печатаем стикер хранения сразу: кладовщик по нему положит вещь на полку.
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title:
            item.material && item.width
              ? `${item.material} ${item.width}×${item.height}`
              : item.product,
          orderNumber: item.orderNumber,
        });
        toast({
          title: res.accrued
            ? `Вещь переупакована · +${res.accrued} ₽`
            : 'Вещь переупакована',
          description: 'Наклейте стикер хранения — кладовщик заберёт вещь на полку',
        });
      } else {
        // Бракованную вещь тоже стикеруем: без наклейки она уезжает из цеха безымянной,
        // и на складе никто не знает, что это и за что списано. Стикер брака заметно
        // отличается от обычного — вещь не положат на полку по ошибке.
        if (res.storageBarcode) {
          printDisposeSticker({
            storageBarcode: res.storageBarcode,
            title:
              item.material && item.width
                ? `${item.material} ${item.width}×${item.height}`
                : item.product,
            orderNumber: item.orderNumber,
            reason: res.disposeReason || note,
          });
        }
        toast({
          title: 'Товар отправлен на утилизацию',
          description: 'Наклейте стикер брака — кладовщик передаст вещь администратору',
        });
      }
      setNotes((prev) => ({ ...prev, [item.id]: '' }));
      load();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-xl text-muted-foreground">
        <Icon name="Loader2" size={32} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <Icon name="PackageCheck" size={72} className="text-muted-foreground" />
        <p className="text-center text-2xl font-semibold">Вещей на перепаковку нет</p>
        <p className="text-center text-muted-foreground">
          Сюда попадают возвраты, которые кладовщик отправил переупаковать
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-lg text-muted-foreground">
        Осмотрите вещь: годная — переупакуйте и наклейте стикер хранения, бракованная —
        спишите с указанием причины
      </p>

      {/* Новый пакет? Спрашиваем перед закрытием перепаковки — по этим ответам видно
          реальный расход упаковки на возвратах. Кнопки крупные: экран сенсорный. */}
      <Dialog open={!!bagAskItem} onOpenChange={(v) => !v && setBagAskItem(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl">Вы взяли новый пакет?</DialogTitle>
          </DialogHeader>

          {bagAskItem && (
            <div className="space-y-4">
              <p className="text-lg text-muted-foreground">
                {bagAskItem.material && bagAskItem.width
                  ? `${bagAskItem.material} ${bagAskItem.width}×${bagAskItem.height}`
                  : bagAskItem.product || 'Товар'}
              </p>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  size="lg"
                  className="h-24 bg-emerald-600 text-xl text-white hover:bg-emerald-700"
                  onClick={() => handleFinish(bagAskItem, 'repacked', true)}
                  disabled={processingId === bagAskItem.id}
                >
                  <Icon name="PackagePlus" size={28} className="mr-2" />
                  Да, новый
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-24 text-xl"
                  onClick={() => handleFinish(bagAskItem, 'repacked', false)}
                  disabled={processingId === bagAskItem.id}
                >
                  <Icon name="Package" size={28} className="mr-2" />
                  Нет, прежний
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {items.map((item) => (
        <Card key={item.id} className="border-border shadow-none">
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xl font-bold">
                  {item.material && item.width
                    ? `${item.material} ${item.width}×${item.height}`
                    : item.product || 'Товар'}
                </p>
                <p className="break-all font-mono-tech text-sm text-muted-foreground">
                  {item.storageBarcode} · {item.orderNumber || '—'}
                </p>
              </div>
              {item.marketplace && <Badge variant="secondary">{item.marketplace}</Badge>}
            </div>

            {item.returnReason && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Почему вернули:</p>
                <p>{item.returnReason}</p>
              </div>
            )}

            {/* Что с вещью — кнопками: на сенсорном киоске текст не набрать.
                Можно отметить несколько дефектов сразу (дырка + пятно), повторное
                нажатие снимает отметку. Выбранное собирается в ту же строку, что
                раньше писали руками, — дальше по системе ничего не меняется. */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Что с вещью (обязательно при списании)</p>
              <div className="grid grid-cols-2 gap-2">
                {['Дырка', 'Затяжка', 'Пятно', 'Брак шва', 'Не тот размер', 'Мятая', 'Грязная', 'Без дефектов'].map(
                  (label) => {
                    const chosen = (notes[item.id] || '')
                      .split(', ')
                      .filter(Boolean);
                    const active = chosen.includes(label);
                    return (
                      <Button
                        key={label}
                        type="button"
                        variant={active ? 'default' : 'outline'}
                        className="h-14 text-base"
                        onClick={() =>
                          setNotes((prev) => {
                            const cur = (prev[item.id] || '').split(', ').filter(Boolean);
                            const next = active
                              ? cur.filter((c) => c !== label)
                              : [...cur, label];
                            return { ...prev, [item.id]: next.join(', ') };
                          })
                        }
                      >
                        {active && <Icon name="Check" size={18} className="mr-1.5" />}
                        {label}
                      </Button>
                    );
                  }
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                size="lg"
                className="h-16 bg-emerald-600 text-lg text-white hover:bg-emerald-700"
                onClick={() => setBagAskItem(item)}
                disabled={processingId === item.id}
              >
                <Icon
                  name={processingId === item.id ? 'Loader2' : 'Check'}
                  size={24}
                  className={`mr-2 ${processingId === item.id ? 'animate-spin' : ''}`}
                />
                Переупаковано — печать стикера
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-16 text-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => handleFinish(item, 'utilized')}
                disabled={processingId === item.id}
              >
                <Icon name="Trash2" size={24} className="mr-2" />
                Брак — печать стикера
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default KioskRepackScreen;
