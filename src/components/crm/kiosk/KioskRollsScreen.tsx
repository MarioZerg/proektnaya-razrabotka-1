import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchRolls, closeRoll, type Roll } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskRollsScreenProps {
  workshopId: number;
}

/** Экран работы с рулонами на терминале: закройщик закрывает рулоны, у которых закончился
 * метраж. Если ткань кончилась раньше — указывает недостачу цифровой клавиатурой. */
const KioskRollsScreen = ({ workshopId }: KioskRollsScreenProps) => {
  const { toast } = useToast();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Roll | null>(null);
  const [shortage, setShortage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchRolls({ status: 'in_workshop' })
      .then((list) => setRolls(list.filter((r) => r.workshopId === workshopId)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId]);

  const handleClose = async (withShortage: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      await closeRoll(selected.id, withShortage ? Number(shortage) || 0 : 0);
      toast({
        title: 'Рулон закрыт',
        description: withShortage && Number(shortage) > 0 ? `Недостача: ${shortage} ${selected.unit}` : undefined,
      });
      setSelected(null);
      setShortage('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось закрыть рулон',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const pressDigit = (d: string) => setShortage((s) => (s + d).slice(0, 6));
  const pressDot = () => setShortage((s) => (s.includes('.') ? s : `${s || '0'}.`));
  const pressBack = () => setShortage((s) => s.slice(0, -1));

  if (selected) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="text-center">
            <p className="text-lg text-muted-foreground">Рулон</p>
            <p className="font-mono-tech text-2xl font-bold">#{selected.barcode}</p>
            <p className="mt-1 text-lg">
              {selected.materialName} · остаток {formatQuantity(selected.remainingQuantity)}{' '}
              {selected.unit}
            </p>
          </div>

          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-sm text-muted-foreground">Недостача (если ткань закончилась раньше)</p>
            <p className="font-mono-tech text-3xl font-bold">{shortage || '0'}</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Button key={d} variant="outline" className="h-16 text-2xl" onClick={() => pressDigit(d)}>
                {d}
              </Button>
            ))}
            <Button variant="outline" className="h-16 text-2xl" onClick={pressDot}>
              ,
            </Button>
            <Button variant="outline" className="h-16 text-2xl" onClick={() => pressDigit('0')}>
              0
            </Button>
            <Button variant="outline" className="h-16" onClick={pressBack}>
              <Icon name="Delete" size={24} />
            </Button>
          </div>

          <Button
            size="lg"
            className="h-16 w-full bg-emerald-600 text-lg text-white hover:bg-emerald-700"
            onClick={() => handleClose(true)}
            disabled={saving}
          >
            <Icon
              name={saving ? 'Loader2' : 'Check'}
              size={24}
              className={`mr-2 ${saving ? 'animate-spin' : ''}`}
            />
            Закрыть рулон
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-full"
            onClick={() => {
              setSelected(null);
              setShortage('');
            }}
          >
            Отмена
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Icon name="Loader2" size={24} className="animate-spin" />
          Загрузка…
        </div>
      ) : rolls.length === 0 ? (
        <p className="py-10 text-center text-lg text-muted-foreground">
          В вашем цехе нет открытых рулонов
        </p>
      ) : (
        rolls.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border p-4 text-left hover:bg-accent"
          >
            <div className="min-w-0">
              <div className="font-mono-tech text-lg font-bold">#{r.barcode}</div>
              <div className="text-muted-foreground">{r.materialName}</div>
            </div>
            <Badge variant="secondary" className="shrink-0 text-base">
              {formatQuantity(r.remainingQuantity)} {r.unit}
            </Badge>
          </button>
        ))
      )}
    </div>
  );
};

export default KioskRollsScreen;
