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
import { widthOptions, heightOptions } from '@/components/crm/sewingItems/sewingItemsShared';
import {
  findStickeringOrders,
  fetchStickeringSewers,
  type KioskOrder,
} from '@/lib/kioskApi';

const ANY = 'any';

interface KioskManualSearchProps {
  onSelect: (order: KioskOrder) => void;
  /** Цех и роль — сервер по ним проверяет, разрешена ли стикеровка в настройках цеха. */
  workshopId?: number | null;
  role?: string | null;
}

/** Запасной способ найти заказ на стикеровке, когда сканер сломался или QR затёрт:
 * упаковщик выбирает размер и находит заказ в списке. Кнопки крупные — экран планшетный. */
const KioskManualSearch = ({ onSelect, workshopId, role }: KioskManualSearchProps) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(ANY);
  const [height, setHeight] = useState(ANY);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<KioskOrder[] | null>(null);
  // Швеи, у которых прямо сейчас есть вещи на стикеровке.
  //
  // Раньше искать можно было только по размеру: админ подходил застикеровать вещь
  // конкретной швеи и выуживал её из общего списка, а при совпадении размеров легко
  // было закрыть чужой заказ. Имя швеи известно наверняка — по нему и ищем.
  const [sewerId, setSewerId] = useState(ANY);
  const [sewers, setSewers] = useState<Array<{ id: number; name: string; count: number }>>([]);

  // Список тянем при открытии поиска: за смену он меняется, держать его заранее незачем.
  useEffect(() => {
    if (!open) return;
    fetchStickeringSewers(workshopId)
      .then(setSewers)
      .catch(() => setSewers([]));
  }, [open, workshopId]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const found = await findStickeringOrders({
        sewerId: sewerId !== ANY ? Number(sewerId) : null,
        width: width !== ANY ? Number(width) : null,
        height: height !== ANY ? Number(height) : null,
        workshopId,
        role,
      });
      setResults(found);
      if (found.length === 0) {
        toast({ title: 'Ничего не найдено', description: 'Попробуйте другой размер' });
      }
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

  if (!open) {
    return (
      <Button variant="outline" size="lg" className="h-16 w-full text-base" onClick={() => setOpen(true)}>
        <Icon name="Search" size={22} className="mr-2" />
        Сканер не работает — найти вручную
      </Button>
    );
  }

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <p className="text-lg font-semibold">Поиск заказа</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={() => {
              setOpen(false);
              setResults(null);
            }}
          >
            <Icon name="X" size={20} />
          </Button>
        </div>

        {/* Швея — первый и самый надёжный фильтр: кто сшил вещь, известно точно,
            а размер на глаз определить сложнее. Рядом с именем — сколько у неё
            вещей на стикеровке, чтобы сразу видеть, есть ли там работа. */}
        <div className="space-y-1.5">
          <Label className="text-base">Швея</Label>
          <Select value={sewerId} onValueChange={setSewerId}>
            <SelectTrigger className="h-14 text-base">
              <SelectValue placeholder="Любая швея" />
            </SelectTrigger>
            <SelectContent className="kiosk-root">
              <SelectItem value={ANY}>Любая швея</SelectItem>
              {sewers.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name} · {s.count}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-base">Ширина</Label>
            <Select value={width} onValueChange={setWidth}>
              <SelectTrigger className="h-14 text-base">
                <SelectValue placeholder="Любая" />
              </SelectTrigger>
              <SelectContent className="kiosk-root">
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
              <SelectContent className="kiosk-root">
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
          Найти заказы
        </Button>

        {results && results.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Найдено: {results.length}</p>
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {results.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    onSelect(o);
                    setOpen(false);
                    setResults(null);
                  }}
                  className="w-full rounded-md border border-border p-4 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono-tech text-base font-bold">{o.orderNumber}</span>
                    {o.marketplace && <Badge variant="secondary">{o.marketplace}</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {o.material} {o.width}×{o.height} · {o.assignedUserName || 'швея не указана'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default KioskManualSearch;