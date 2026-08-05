import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { printStorageSticker } from '@/lib/printStorageSticker';
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

  const load = () => {
    setLoading(true);
    fetchRepackItems()
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleFinish = async (item: RepackItem, outcome: 'repacked' | 'utilized') => {
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
    try {
      const res = await finishRepack({ id: item.id, outcome, note, actorId, actorName });

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
          title: 'Вещь переупакована',
          description: 'Наклейте стикер хранения — кладовщик заберёт вещь на полку',
        });
      } else {
        toast({
          title: 'Товар списан',
          description: 'Брак попадёт в отчёт администратору',
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

            <Textarea
              placeholder="Что с вещью: дырки, пятна, затяжки (обязательно при списании)"
              value={notes[item.id] || ''}
              onChange={(e) => setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
              rows={2}
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                size="lg"
                className="h-16 bg-emerald-600 text-lg text-white hover:bg-emerald-700"
                onClick={() => handleFinish(item, 'repacked')}
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
                Брак — списать
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default KioskRepackScreen;
