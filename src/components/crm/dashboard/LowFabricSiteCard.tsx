import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchLowFabric, setSiteDisabled, type LowFabric } from '@/lib/siteOrdersApi';

/**
 * Админу: ткани меньше 20 м (склад + цех), а товары сайта на этой ткани
 * ещё продаются. Кнопка выключает их на мегатюль.рф.
 */
const LowFabricSiteCard = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [fabrics, setFabrics] = useState<LowFabric[]>([]);
  const [threshold, setThreshold] = useState(20);
  const [busy, setBusy] = useState<number | null>(null);

  const load = () =>
    fetchLowFabric()
      .then((r) => {
        setFabrics(r.fabrics);
        setThreshold(r.threshold);
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const disable = async (f: LowFabric) => {
    setBusy(f.materialId);
    try {
      const r = await setSiteDisabled({ materialId: f.materialId }, true, { id: user?.id, name: user?.name });
      toast(
        r.pushed
          ? { title: `Выключено на сайте: ${r.changed ?? f.activeItems}` }
          : { title: 'Выключено у нас, на сайт не ушло', description: r.pushError || undefined, variant: 'destructive' }
      );
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (fabrics.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 font-semibold text-amber-900">
          <Icon name="TriangleAlert" size={18} />
          Ткани осталось мало — требуется выключить товар на сайте
        </div>
        <p className="text-sm text-amber-900/80">
          Меньше {threshold} м на складе и в цехе, а товары на этой ткани ещё продаются на мегатюль.рф.
        </p>
        <div className="space-y-2">
          {fabrics.map((f) => (
            <div
              key={f.materialId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium text-foreground">{f.name}</span>
                <span className="ml-2 text-muted-foreground">
                  осталось {f.meters} м · товаров на сайте: {f.activeItems}
                </span>
              </div>
              <Button size="sm" variant="destructive" disabled={busy === f.materialId} onClick={() => disable(f)}>
                <Icon
                  name={busy === f.materialId ? 'Loader2' : 'EyeOff'}
                  size={14}
                  className={`mr-1 ${busy === f.materialId ? 'animate-spin' : ''}`}
                />
                Выключить на сайте
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default LowFabricSiteCard;
