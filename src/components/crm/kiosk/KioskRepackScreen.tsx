import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchRepackItems, finishRepack, type RepackItem } from '@/lib/kioskApi';

interface KioskRepackScreenProps {
  actorId: number;
  actorName: string;
}

/** Перепаковка: вещи вернулись от покупателя годными, но с помятой упаковкой. Упаковщик
 * переупаковывает их и отправляет обратно на склад — там они снова ждут полку. */
const KioskRepackScreen = ({ actorId, actorName }: KioskRepackScreenProps) => {
  const { toast } = useToast();
  const [items, setItems] = useState<RepackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchRepackItems()
      .then(setItems)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDone = async (item: RepackItem) => {
    setProcessingId(item.id);
    try {
      await finishRepack(item.id, actorId, actorName);
      toast({
        title: 'Вещь переупакована',
        description: 'Отправлена на склад — кладовщик положит её на полку',
      });
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
        Переупакуйте вещь в новый пакет и нажмите «Готово» — она вернётся на склад
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

            <Button
              size="lg"
              className="h-16 w-full bg-emerald-600 text-lg text-white hover:bg-emerald-700"
              onClick={() => handleDone(item)}
              disabled={processingId === item.id}
            >
              <Icon
                name={processingId === item.id ? 'Loader2' : 'Check'}
                size={24}
                className={`mr-2 ${processingId === item.id ? 'animate-spin' : ''}`}
              />
              Готово — переупаковано
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default KioskRepackScreen;
