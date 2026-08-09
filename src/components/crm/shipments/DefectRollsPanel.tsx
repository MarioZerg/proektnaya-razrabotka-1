import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchRolls,
  receiveDefectRoll,
  declineDefectRoll,
  type Roll,
} from '@/lib/rollsApi';

const formatQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Забор бракованных рулонов из цеха — на странице приёмки от поставщика.
 *
 * Закройщик встретил брак в начале рулона и отставил его: рулон физически в цехе, но
 * в раскрой уже не идёт. Кладовщик забирает такой рулон СКАНИРОВАНИЕМ штрихкода —
 * так видно, что рулон реально доехал до склада, а не остался лежать в цехе.
 *
 * Панель стоит здесь, потому что дальше судьба рулона решается с поставщиком: возврат
 * или скидка. Кладовщику удобно — забрал рулон и тут же оформил документы.
 */
const DefectRollsPanel = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [rolls, setRolls] = useState<Roll[]>([]);
  // Забранные на склад бракованные рулоны: ждут решения по поставщику.
  const [onStock, setOnStock] = useState<Roll[]>([]);
  const [open, setOpen] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [declining, setDeclining] = useState<Roll | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    fetchRolls()
      .then((list) => {
        // Ждут забора — только те, что ещё physически в цехе. Уже привезённые на склад
        // остаются помеченными (в раскрой не идут), но забирать их больше не нужно.
        setRolls(list.filter((r) => r.defectFlaggedAt && r.status === 'in_workshop'));
        setOnStock(
          list.filter((r) => r.defectFlaggedAt && r.status === 'in_storage'),
        );
      })
      .catch(() => setRolls([]));
  };

  useEffect(load, []);

  const handleScan = async () => {
    const value = barcode.trim();
    if (!value || saving) return;
    setBarcode('');
    setSaving(true);
    try {
      const res = await receiveDefectRoll(value, user?.id, user?.name);
      toast({
        title: `Рулон ${res.barcode} принят на склад`,
        description: `${res.materialName} — ${formatQty(res.remaining)} ${res.unit || ''}. ${res.reason || ''}`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось забрать рулон',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleDecline = async () => {
    if (!declining || !declineReason.trim()) return;
    setSaving(true);
    try {
      await declineDefectRoll(declining.id, declineReason.trim(), user?.id);
      toast({
        title: 'Отказано в заборе',
        description: `Рулон ${declining.barcode} снова доступен для раскроя`,
      });
      setDeclining(null);
      setDeclineReason('');
      load();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Пока брака нет вообще, панель не занимает место на странице.
  if (rolls.length === 0 && onStock.length === 0 && !open) return null;

  return (
    <>
      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Icon name="PackageX" size={22} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-bold text-amber-900">
                  На производстве брак: {rolls.length} рулон
                  {rolls.length === 1 ? '' : rolls.length < 5 ? 'а' : 'ов'}
                </p>
                <p className="text-sm text-amber-900">
                  Закройщик отставил рулоны — заберите их на склад и решите с поставщиком:
                  возврат или скидка
                </p>
              </div>
            </div>
            <Button
              onClick={() => {
                setOpen(true);
                setTimeout(() => inputRef.current?.focus(), 100);
              }}
            >
              <Icon name="ScanLine" size={16} className="mr-2" />
              Забрать рулоны
            </Button>
          </div>

          <div className="space-y-2">
            {rolls.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.materialName} — {formatQty(r.remainingQuantity)} {r.unit || ''}
                    <Badge variant="secondary" className="ml-2 font-mono-tech">
                      {r.barcode}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {r.defectReason}
                    {r.defectFlaggedByName && ` · отставил ${r.defectFlaggedByName}`}
                    {r.workshopName && ` · ${r.workshopName}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDeclining(r);
                    setDeclineReason('');
                  }}
                >
                  Отказать
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Уже на складе: рулон привезли, но он всё ещё бракованный и в работу не идёт.
          Дальше — возврат поставщику или скидка, решает руководитель. */}
      {onStock.length > 0 && (
        <Card className="border-sky-300 bg-sky-50 shadow-none">
          <CardContent className="space-y-2 py-4">
            <div className="flex items-start gap-3">
              <Icon name="Warehouse" size={22} className="mt-0.5 shrink-0 text-sky-600" />
              <div>
                <p className="font-bold text-sky-900">
                  На складе, ждут решения: {onStock.length} шт.
                </p>
                <p className="text-sm text-sky-900">
                  Рулоны привезены из цеха и в раскрой не идут. Договоритесь с поставщиком:
                  возврат или скидка. Если рулон решили оставить в работу — нажмите «Вернуть»
                </p>
              </div>
            </div>
            {onStock.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {r.materialName} — {formatQty(r.remainingQuantity)} {r.unit || ''}
                    <Badge variant="secondary" className="ml-2 font-mono-tech">
                      {r.barcode}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">{r.defectReason}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDeclining(r);
                    setDeclineReason('');
                  }}
                >
                  Вернуть в работу
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Забор сканером: кладовщик подходит с терминалом и сканирует рулоны подряд. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Забрать бракованные рулоны</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Отсканируйте штрихкод на рулоне — так подтверждается, что рулон доехал
              до склада
            </p>
            <Input
              ref={inputRef}
              autoFocus
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              placeholder="Штрихкод рулона"
              className="h-14 font-mono-tech text-lg"
              disabled={saving}
            />
            {rolls.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Осталось забрать: {rolls.length} шт.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Отказ: брак не подтвердился, рулон возвращается в работу. */}
      <Dialog open={!!declining} onOpenChange={(v) => !v && setDeclining(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Отказать в заборе рулона</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Рулон {declining?.barcode} останется в цехе и снова станет доступен для
              раскроя. Напишите, почему брак не подтвердился
            </p>
            <Textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Осмотрел рулон — брак только на первом метре, дальше полотно чистое"
              rows={3}
            />
            <Button
              onClick={handleDecline}
              disabled={saving || !declineReason.trim()}
              className="w-full"
            >
              {saving ? (
                <Icon name="Loader2" size={16} className="animate-spin" />
              ) : (
                'Вернуть рулон в работу'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DefectRollsPanel;
