import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { fetchPendingDefects, receiveDefect, type PendingDefect } from '@/lib/kioskApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskDefectReceiveScreenProps {
  actorId: number;
  actorName: string;
}

/**
 * Приёмка брака кладовщиком.
 *
 * Швеи и закройщики складывают бракованные куски в контейнер, наклеив стикер. Кладовщик
 * сканирует каждый стикер — так брак официально доезжает до склада. Пока стикер не
 * отсканирован, брак числится «в контейнере»: сразу видно, что реально доехало, а что
 * потерялось по дороге.
 */
const KioskDefectReceiveScreen = ({ actorId, actorName }: KioskDefectReceiveScreenProps) => {
  const { toast } = useToast();
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingDefect[]>([]);
  const [received, setReceived] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetchPendingDefects()
      .then(setPending)
      .catch(() => setPending([]));
  };

  useEffect(() => {
    load();
  }, []);

  const handleScan = async () => {
    const value = barcode.trim();
    if (!value) return;
    setBarcode('');
    setSaving(true);
    try {
      const res = await receiveDefect(value, actorId, actorName);
      playScanSound();
      toast({
        title: `Брак принят: ${res.materialName}`,
        description: `${formatQuantity(res.quantity)} ${res.unit || ''} — ${res.reasonLabel} (нашёл: ${res.foundBy})`,
      });
      setReceived((prev) => [res.barcode, ...prev].slice(0, 10));
      load();
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось принять брак',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !saving);

  const totalPending = pending.reduce((sum, p) => sum + p.quantity, 0);

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5 shadow-none">
        <CardContent className="space-y-3 pt-6">
          <p className="text-lg font-bold">Приём брака из цеха</p>
          <p className="text-base text-muted-foreground">
            Отсканируйте стикер на каждом бракованном куске из контейнера
          </p>
          <Input
            ref={inputRef}
            autoFocus
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            placeholder="DF-000001"
            className="h-16 text-xl"
            disabled={saving}
          />
          {received.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Принято за сеанс: {received.length} — {received.slice(0, 5).join(', ')}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">Ждёт приёмки</span>
        <Badge variant={pending.length ? 'destructive' : 'secondary'}>
          {pending.length} шт. · {formatQuantity(totalPending)} пог.м.
        </Badge>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Icon name="PackageCheck" size={56} className="text-muted-foreground" />
          <p className="text-xl font-semibold">Весь брак принят на склад</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((p) => (
            <Card key={p.barcode} className="border-border shadow-none">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {p.materialName} — {formatQuantity(p.quantity)} {p.unit || ''}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {p.reasonLabel} · {p.userName}
                    {p.workshopName ? ` · ${p.workshopName}` : ''}
                  </p>
                </div>
                <Badge variant="outline" className="font-mono-tech">
                  {p.barcode}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default KioskDefectReceiveScreen;
