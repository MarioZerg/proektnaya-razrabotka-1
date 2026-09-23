import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { syncOzonCargoes } from '@/lib/ozonFboApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface OzonCargoSyncCardProps {
  supply: SupplyDetail;
  /** Перечитать поставку после сверки. */
  onSynced: () => void;
}

/**
 * Сверка грузомест с OZON — лечит «лишние короба» на площадке.
 *
 * ЗАЧЕМ. На OZON копятся грузоместа-сироты: короб удалили у нас, а место
 * осталось висеть с полным товарным составом. Заявка ждёт больше коробов,
 * чем реально приедет, и на приёмке всплывает одинаковый товар под разными
 * штрихкодами.
 *
 * Причины закрыты в коде, но уже накопленный мусор надо чем-то убрать —
 * этим и занимается кнопка. Она ничего не создаёт: только сверяет список
 * мест на площадке с нашими коробами и снимает лишнее.
 */
const OzonCargoSyncCard = ({ supply, onSynced }: OzonCargoSyncCardProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  // Итог последней сверки держим на карточке, а не только в тосте: тост
  // уезжает через пару секунд, а расхождение надо разбирать руками — и
  // кладовщику нужно видеть цифры, пока он это делает.
  const [result, setResult] = useState<{
    onOzon: number;
    removed: number;
    lost: number;
    note?: string;
  } | null>(null);

  // Сверять есть с чем, только когда хотя бы один короб уехал на OZON.
  const closedOnOzon = supply.boxes.filter((b) => b.ozonCargoId).length;
  if (closedOnOzon === 0) return null;

  const handleSync = async () => {
    setBusy(true);
    try {
      const r = await syncOzonCargoes(supply.id, { id: user?.id, name: user?.name });
      if (!r.done) {
        setResult(null);
        toast({ title: 'OZON ещё обрабатывает запрос', description: r.note });
        return;
      }
      setResult({
        onOzon: r.onOzon ?? 0,
        removed: r.removed ?? 0,
        lost: r.lost ?? 0,
        note: r.note,
      });
      toast({
        title: r.removed
          ? `Снято лишних коробов: ${r.removed}`
          : r.lost
            ? `Открыто заново коробов без места: ${r.lost}`
            : 'Всё сходится',
        description: r.note,
        variant: r.lost ? 'destructive' : undefined,
      });
      onSynced();
    } catch (e) {
      setResult(null);
      toast({
        title: 'Не удалось сверить с OZON',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const mismatch = result ? result.onOzon !== closedOnOzon || result.lost > 0 : false;

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <Icon name="ShieldCheck" size={16} className="text-[#005BFF]" />
              Сверка коробов с OZON
            </p>
            <p className="text-sm text-muted-foreground">
              Сверит короба с площадкой: лишние на OZON уберёт, а те, что остались
              без грузоместа, откроет заново — их нужно будет закрыть ещё раз.
              У нас закрыто и заведено: {closedOnOzon}
            </p>
          </div>
          <Button variant="outline" onClick={handleSync} disabled={busy}>
            <Icon
              name={busy ? 'Loader2' : 'RefreshCw'}
              size={16}
              className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
            />
            {busy ? 'Сверяем…' : 'Проверить OZON'}
          </Button>
        </div>

        {/* ИТОГ СВЕРКИ ЦИФРАМИ, А НЕ ОДНИМ СЛОВОМ.
            «Всё сходится» без чисел нечем проверить: кладовщик видит девять
            коробов у себя и верит надписи, даже когда на площадке их одно.
            Показываем оба числа рядом — расхождение видно сразу. */}
        {result && (
          <div
            className={`rounded-md border p-3 text-sm ${
              mismatch
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-emerald-300 bg-emerald-50 text-emerald-900'
            }`}
          >
            <p className="flex items-start gap-2 font-medium">
              <Icon
                name={mismatch ? 'TriangleAlert' : 'CircleCheck'}
                size={14}
                className="mt-0.5 shrink-0"
              />
              <span>
                На OZON грузомест: {result.onOzon} · закрытых коробов у нас:{' '}
                {closedOnOzon}
              </span>
            </p>
            {result.note && <p className="mt-1 pl-6">{result.note}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OzonCargoSyncCard;