import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchGazelkaPlans, type GazelkaPlan } from '@/lib/gazelkaApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface GazelkaLabelsCardProps {
  supply: SupplyDetail;
}

/**
 * Упаковочные листы Газельки на экране сборки — маркировка коробов.
 *
 * ЗАЧЕМ ЗДЕСЬ, А НЕ ТОЛЬКО В КАРТОЧКЕ ПОСТАВКИ. Лист Газельки клеится на короб
 * в тот же момент, когда короб заклеивают — то есть прямо во время сборки.
 * Раньше кнопка печати жила только в карточке поставки, у блока перевозки:
 * кладовщик заканчивал сборку, уходил, а короба оставались без маркировки —
 * перевозчик такие не принимает.
 *
 * Листов печатается столько, сколько коробов в поставке: на каждом свой номер
 * в штрихкоде (BOX=001, BOX=002…), перепутать нельзя.
 *
 * Карточка сама прячется, если поставка не привязана к заявке Газельки —
 * печатать тогда нечего.
 */
const GazelkaLabelsCard = ({ supply }: GazelkaLabelsCardProps) => {
  const { toast } = useToast();
  const [plan, setPlan] = useState<GazelkaPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

  // Данные заявки тянем только когда она вообще привязана: лишний поход
  // во внешний сервис на каждом открытии экрана сборки ни к чему.
  useEffect(() => {
    if (!supply.gazelkaPlanId) return;
    setLoading(true);
    fetchGazelkaPlans()
      .then((plans) => setPlan(plans.find((p) => p.id === supply.gazelkaPlanId) || null))
      .catch(() => setPlan(null))
      .finally(() => setLoading(false));
  }, [supply.gazelkaPlanId]);

  if (!supply.gazelkaPlanId) return null;

  // Ждём только код склада (IDS): его в API Газельки нет ни в каком виде, менеджер
  // вводит его руками на карточке поставки. Всё остальное штрихкод берёт из заявки —
  // в том числе IDM (код маркетплейса), который раньше тоже требовали вводить.
  // Без IDS лист печатается с нулями, и перевозчик его не опознаёт.
  const ready = !!supply.gazelkaIds;
  const boxesCount = supply.boxes.length || plan?.boxes || 1;

  const handlePrint = async () => {
    if (!plan) return;
    setPrinting(true);
    try {
      const { printGazelkaLabels } = await import('@/lib/gazelkaPackingLabel');
      printGazelkaLabels({ plan, supply, boxesCount });
    } catch (e) {
      toast({
        title: 'Не удалось напечатать листы',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Card className="border-[#004cdb]/30 bg-[#004cdb]/5 shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <Icon name="Truck" size={16} className="text-[#004cdb]" />
            Упаковочные листы Газельки
          </p>
          <p className="text-sm text-muted-foreground">
            {ready
              ? `Заявка №${supply.gazelkaPlanId} · ${boxesCount} ${
                  boxesCount === 1 ? 'лист' : 'листов'
                } — по одному на короб. Наклейте на короба перед отгрузкой`
              : 'Менеджер ещё не заполнил код склада (IDS) по заявке — без него штрихкод листа не соберётся'}
          </p>
        </div>
        <Button
          className="bg-[#004cdb] text-white hover:bg-[#003bb0]"
          onClick={handlePrint}
          disabled={!ready || !plan || loading || printing}
        >
          <Icon
            name={loading || printing ? 'Loader2' : 'Printer'}
            size={16}
            className={`mr-1.5 ${loading || printing ? 'animate-spin' : ''}`}
          />
          {loading ? 'Загрузка заявки…' : 'Печать листов Газельки'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default GazelkaLabelsCard;