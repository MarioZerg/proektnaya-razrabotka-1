import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { findStickeringOrders, type KioskOrder } from '@/lib/kioskApi';

interface Props {
  onSelect: (order: KioskOrder) => void;
}

/** Запасной способ найти заказ на стикеровке, если сканер сломался или штрихкод затёрт:
 * упаковщик задаёт размер/материал и выбирает нужный заказ из списка. */
const KioskManualSearch = ({ onSelect }: Props) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [material, setMaterial] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<KioskOrder[] | null>(null);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const found = await findStickeringOrders({
        width: width ? Number(width) : null,
        height: height ? Number(height) : null,
        material: material.trim() || null,
      });
      setResults(found);
      if (found.length === 0) {
        toast({ title: 'Ничего не найдено', description: 'Попробуйте изменить размер или материал' });
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
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Icon name="Search" size={16} className="mr-2" />
        Сканер не работает — найти вручную
      </Button>
    );
  }

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Поиск заказа вручную</span>
          <button
            onClick={() => {
              setOpen(false);
              setResults(null);
            }}
            className="text-muted-foreground transition hover:text-foreground"
            aria-label="Закрыть ручной поиск"
          >
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Ширина, см"
            value={width}
            onChange={(e) => setWidth(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
          <Input
            placeholder="Высота, см"
            value={height}
            onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </div>
        <Input
          placeholder="Материал (необязательно)"
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
        />

        <Button className="w-full" onClick={handleSearch} disabled={loading}>
          {loading ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Найти заказы'}
        </Button>

        {results && results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Найдено: {results.length}</p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {results.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    onSelect(o);
                    setOpen(false);
                    setResults(null);
                  }}
                  className="w-full rounded-md border border-border p-3 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono-tech text-sm font-medium">{o.orderNumber}</span>
                    <span className="text-xs text-muted-foreground">{o.marketplace}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
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
