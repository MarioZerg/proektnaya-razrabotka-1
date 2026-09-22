import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchGazelkaPlans, type GazelkaPlan } from '@/lib/gazelkaApi';
import { missingLabelFields } from '@/lib/gazelkaPackingLabel';
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

  const boxesCount = supply.boxes.length || plan?.boxes || 1;

  // Печать открываем только когда заполнено ВСЁ, что попадает на лист: даты, склад,
  // номер поставки, код IDS и реквизиты клиента. Незаполненное печатается прочерком
  // (а в QR — нулями), и выясняется это уже на приёмке, когда короба сняты с машины.
  // Список недостающего показываем прямо здесь, чтобы кладовщик знал, что просить
  // у менеджера, а не гадал, почему кнопка серая.
  const missing = plan ? missingLabelFields({ plan, supply, boxesCount }) : [];
  const ready = !!plan && missing.length === 0;

  const handlePrint = async () => {
    if (!plan) return;
    setPrinting(true);
    try {
      const { printGazelkaLabels } = await import('@/lib/gazelkaPackingLabel');
      // Ждём: коды рисуются асинхронно, и без await ошибка генерации потерялась бы —
      // кладовщик увидел бы «готово», а на принтер ушли бы пустые листы.
      await printGazelkaLabels({ plan, supply, boxesCount });
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
              : loading
                ? 'Загружаем заявку Газельки…'
                : 'Менеджер ещё не заполнил данные поставки — лист напечатался бы с пустыми полями'}
          </p>
          {!ready && !loading && missing.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {missing.map((m) => (
                <li key={m} className="flex items-center gap-1.5">
                  <Icon name="CircleAlert" size={12} className="shrink-0 text-amber-600" />
                  {m}
                </li>
              ))}
            </ul>
          )}
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