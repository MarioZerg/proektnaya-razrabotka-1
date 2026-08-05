import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { printBarcodes } from '@/lib/printBarcodes';
import { widthOptions, heightOptions } from '@/components/crm/sewingItems/sewingItemsShared';
import {
  findUnlabeledGoods,
  fetchUnlabeledSewers,
  reprintStorageLabel,
  type UnlabeledCandidate,
} from '@/lib/kioskApi';

const ANY = 'any';

interface KioskUnlabeledScreenProps {
  /** Кладовщик, который перепечатывает стикер — попадёт в отчёт админу. */
  actorId?: number;
  actorName?: string;
}

/** Экран кладовщика на терминале: в цехе нашлась вещь без стикера хранения (упаковщица не
 * наклеила или стикер потерялся). Кладовщик ищет, чей это товар, по швее и размеру среди
 * отменённых заказов, ожидающих укладки на полку, и печатает стикер заново. */
const KioskUnlabeledScreen = ({ actorId, actorName }: KioskUnlabeledScreenProps) => {
  const { toast } = useToast();
  const [sewers, setSewers] = useState<Array<{ id: number; name: string }>>([]);
  const [sewerId, setSewerId] = useState(ANY);
  const [width, setWidth] = useState(ANY);
  const [height, setHeight] = useState(ANY);
  const [candidates, setCandidates] = useState<UnlabeledCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetchUnlabeledSewers()
      .then(setSewers)
      .catch(() => setSewers([]));
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await findUnlabeledGoods({
        sewerId: sewerId !== ANY ? Number(sewerId) : undefined,
        width: width !== ANY ? Number(width) : undefined,
        height: height !== ANY ? Number(height) : undefined,
      });
      setCandidates(res);
      setSearched(true);
    } catch (e) {
      toast({
        title: 'Ошибка поиска',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = (c: UnlabeledCandidate) => {
    // Фиксируем перепечатку: админ увидит, по чьей вине стикера не оказалось на товаре.
    reprintStorageLabel(c.id, actorId, actorName);
    printBarcodes(
      [{ code: c.storageBarcode, label: `${c.orderNumber} — ${c.product || ''}` }],
      `Стикер хранения ${c.storageBarcode}`,
    );
    toast({
      title: 'Стикер отправлен на печать',
      description: `Наклейте его на товар ${c.product || ''}`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-400 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <Icon name="TriangleAlert" size={28} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-lg font-bold text-amber-900">Товар без стикера хранения</p>
            <p className="mt-1 text-sm text-amber-800">
              Если в цехе нашлась вещь без стикера — упаковщица могла его не наклеить или он
              потерялся. Найдите товар по швее и размеру и распечатайте стикер заново.
            </p>
          </div>
        </div>
      </div>

      <Card className="border-border shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-base">Швея</Label>
              <Select value={sewerId} onValueChange={setSewerId}>
                <SelectTrigger className="h-14 text-base">
                  <SelectValue placeholder="Любая" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Любая швея</SelectItem>
                  {sewers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-base">Ширина</Label>
              <Select value={width} onValueChange={setWidth}>
                <SelectTrigger className="h-14 text-base">
                  <SelectValue placeholder="Любая" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Любая</SelectItem>
                  {widthOptions.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-base">Высота</Label>
              <Select value={height} onValueChange={setHeight}>
                <SelectTrigger className="h-14 text-base">
                  <SelectValue placeholder="Любая" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Любая</SelectItem>
                  {heightOptions.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button size="lg" className="h-16 w-full text-lg" onClick={handleSearch} disabled={loading}>
            <Icon
              name={loading ? 'Loader2' : 'Search'}
              size={24}
              className={`mr-2 ${loading ? 'animate-spin' : ''}`}
            />
            Найти товар
          </Button>
        </CardContent>
      </Card>

      {searched && candidates.length === 0 && (
        <Card className="border-border shadow-none">
          <CardContent className="py-8 text-center">
            <Icon name="PackageX" size={48} className="mx-auto text-muted-foreground" />
            <p className="mt-3 text-lg font-semibold">Подходящих товаров не найдено</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Возможно, вещь уже лежит на полке или отменённых заказов такого размера нет.
              Попробуйте убрать часть условий поиска
            </p>
          </CardContent>
        </Card>
      )}

      {candidates.length > 0 && (
        <div className="space-y-3">
          <p className="text-lg font-semibold">
            Возможно, это один из этих товаров: {candidates.length}
          </p>
          {candidates.map((c) => (
            <Card key={c.id} className="border-border shadow-none">
              <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{c.product}</span>
                    <Badge variant="secondary">{c.marketplace}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Заказ <span className="font-mono-tech">{c.orderNumber}</span> ·{' '}
                    {c.material} {c.width}×{c.height}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Швея: {c.sewerName || '—'} · Упаковщик: {c.packerName || '—'}
                  </div>
                  <div className="font-mono-tech text-sm font-semibold">{c.storageBarcode}</div>
                </div>
                <Button size="lg" className="h-14 shrink-0 text-base" onClick={() => handlePrint(c)}>
                  <Icon name="Printer" size={20} className="mr-2" />
                  Печать стикера
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default KioskUnlabeledScreen;
