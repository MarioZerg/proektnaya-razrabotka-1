import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchOzonAllBoxLabels } from '@/lib/ozonFboApi';
import { printBoxLabelFromUrl } from '@/lib/printMarketplaceLabel';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface SupplyAllLabelsCardProps {
  supply: SupplyDetail;
  /** Весь ли товарный состав разложен по коробам. */
  fullyAssembled: boolean;
}

/**
 * МАССОВАЯ ПЕЧАТЬ СТИКЕРОВ КОРОБОВ — один PDF на всю поставку.
 *
 * Короб закрывают по одному и печатают наклейку тут же — это рабочий порядок,
 * он остаётся. Но когда поставка собрана целиком, кладовщику удобнее один раз
 * отправить на принтер весь комплект, а не открывать каждый короб заново и
 * жать печать двадцать раз подряд.
 *
 * Карточка появляется только когда печатать РЕАЛЬНО ЕСТЬ ЧТО: товар разложен
 * полностью и все короба закрыты. Пока сборка идёт, показывать её нельзя —
 * кладовщик напечатает половину наклеек и решит, что комплект готов.
 *
 * Страницы в файле идут по номерам коробов: лист №1 — короб №1. Иначе пачка
 * на выходе из принтера ложится вразнобой и её приходится перебирать.
 */
const SupplyAllLabelsCard = ({ supply, fullyAssembled }: SupplyAllLabelsCardProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  // Короба с товаром: пустые в комплект не идут, грузоместа у них нет.
  const filledBoxes = supply.boxes.filter((b) => b.items.length > 0);
  const closedBoxes = filledBoxes.filter((b) => b.closedAt);
  const allClosed = filledBoxes.length > 0 && closedBoxes.length === filledBoxes.length;

  // Показываем, только когда поставка собрана и заклеена целиком.
  if (!fullyAssembled || !allClosed) return null;

  const handlePrintAll = async () => {
    setBusy(true);
    try {
      const res = await fetchOzonAllBoxLabels(supply.id, {
        id: user?.id,
        name: user?.name,
      });
      await printBoxLabelFromUrl(res.url, `Стикеры коробов поставки №${supply.id}`);

      // Короб без стикера — редкость (OZON не отдал этикетку), но молчать
      // о нём нельзя: кладовщик уедет с непромаркированным коробом.
      if (res.missingBoxes.length) {
        toast({
          title: `Напечатано наклеек: ${res.boxes}`,
          description: `Без стикера остались короба: №${res.missingBoxes.join(', №')}. `
            + 'Откройте их и нажмите «Повторить отправку на OZON»',
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Отправлено на печать: ${res.boxes} наклеек`,
          description: 'Листы идут по номерам коробов — лист №1 на короб №1',
        });
      }
    } catch (e) {
      toast({
        title: 'Не удалось напечатать стикеры',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-emerald-300 bg-emerald-50 shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-emerald-900">
            <Icon name="Printer" size={16} />
            Все короба закрыты — можно печатать стикеры пачкой
          </p>
          <p className="text-sm text-emerald-900">
            Один файл на {filledBoxes.length}{' '}
            {filledBoxes.length === 1 ? 'короб' : 'коробов'} — по наклейке на каждый,
            в порядке номеров
          </p>
        </div>
        <Button
          className="bg-[#005BFF] text-white hover:bg-[#0047cc]"
          onClick={handlePrintAll}
          disabled={busy}
        >
          <Icon
            name={busy ? 'Loader2' : 'Printer'}
            size={16}
            className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
          />
          {busy ? 'Собираем файл…' : 'Печать всех стикеров коробов'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default SupplyAllLabelsCard;
