import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { pullOzonOrdersByNumbers, type OzonSyncResult } from '@/lib/ozonFbsApi';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Заказы подгрузились — обновить таблицу на странице. */
  onDone: () => void;
}

/**
 * Ручная догрузка отправления OZON по номеру.
 *
 * Обычная загрузка идёт по ленте маркетплейса пачками. Изредка конкретный заказ в
 * неё не попадает: оборвалась связь, отправление появилось задним числом, лента
 * ушла вперёд. Раньше оставалось только ждать следующего круга и надеяться —
 * а заказ тем временем висел «в ожидании сборки» на стороне OZON.
 *
 * Здесь администратор вбивает номер и забирает отправление адресно. Номер
 * проверяется НА САМОМ OZON: чего нет у маркетплейса, то не создастся и у нас —
 * выдумать заказ через это окно нельзя. Дальше всё как при обычной загрузке:
 * многовещевое отправление разделится на отдельные задания, товар подтянется из
 * справочника, а если такая вещь уже лежит на складе — заказ закроется ею, минуя цех.
 *
 * Можно вставить сразу несколько номеров — по одному в строке или через запятую.
 */
const PullOrderByNumberDialog = ({ open, onOpenChange, onDone }: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OzonSyncResult | null>(null);

  const numbers = text
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);

  const close = (v: boolean) => {
    if (loading) return;
    if (!v) {
      setText('');
      setResult(null);
    }
    onOpenChange(v);
  };

  const handlePull = async () => {
    if (numbers.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await pullOzonOrdersByNumbers(numbers, {
        id: user?.id,
        name: user?.name,
      });
      setResult(res);
      if (res.created > 0) {
        toast({
          title: `Загружено заказов: ${res.created}`,
          description: res.createdNumbers?.join(', '),
        });
        onDone();
      }
    } catch (e) {
      toast({
        title: 'Не удалось загрузить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Загрузить заказ OZON по номеру</DialogTitle>
          <DialogDescription>
            Если заказа нет на конвейере, впишите номер отправления — система заберёт
            его с OZON напрямую. Несколько номеров можно вставить сразу, по одному в
            строке.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'0182887297-0307-1\n18816178-1139-1'}
          rows={4}
          disabled={loading}
          className="font-mono text-sm"
        />
        {numbers.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Номеров к загрузке: {numbers.length}
          </p>
        )}

        {result && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
            <p>
              Загружено: <span className="font-semibold">{result.created}</span>
            </p>
            {result.skippedExisting > 0 && (
              <p className="text-muted-foreground">
                Уже были в системе: {result.skippedExisting}
              </p>
            )}
            {result.skippedNoItem > 0 && (
              <p className="text-amber-700">
                Не найден товар в справочнике: {result.skippedNoItem}. Заведите карточку
                товара и повторите.
              </p>
            )}
            {result.created === 0 &&
              result.skippedExisting === 0 &&
              result.skippedNoItem === 0 && (
                <p className="text-amber-700">
                  OZON не вернул такое отправление. Проверьте номер — возможно, заказ
                  уже собран, отменён или принадлежит другому кабинету.
                </p>
              )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={loading}>
            Закрыть
          </Button>
          <Button onClick={handlePull} disabled={loading || numbers.length === 0}>
            {loading && <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />}
            {loading ? 'Загружаем...' : 'Загрузить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PullOrderByNumberDialog;
