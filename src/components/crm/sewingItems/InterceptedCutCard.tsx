import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { printCuttingSheet } from '@/lib/printCuttingSheet';
import {
  fetchInterceptedOrders,
  fetchInterceptedSheet,
  markInterceptedSheetPrinted,
  type KioskInterceptedOrder,
} from '@/lib/kioskApi';

interface Props {
  /** Швея, которой принадлежат вещи. Без неё карточка не показывается. */
  sewerId?: number;
  sewerName?: string;
  workshopId: number | null;
  /** Показывать только швее: у закройщика свой лист по стеку. */
  visible: boolean;
}

/**
 * ПЕРЕХВАЧЕННЫЙ КРОЙ В ПРОФИЛЕ ШВЕИ.
 *
 * ЧТО ТАКОЕ ПЕРЕХВАТ. Покупатель отменил заказ уже после раскроя, а следом пришёл
 * новый заказ того же размера — крой отдали ему. Бирка на вешалке при этом осталась
 * от ОТМЕНЁННОГО заказа: перепечатать её в момент перехвата некому.
 *
 * ЗАЧЕМ КНОПКА ЗДЕСЬ, ЕСЛИ ЕСТЬ ТЕРМИНАЛ. Лист печатают на терминале в цехе, но он
 * рвётся, теряется и остаётся на столе. Бежать за ним к терминалу через весь цех
 * швея не пойдёт — она просто продолжит шить вещь с чужой биркой. Здесь лист у неё
 * под рукой, на той же странице, где она берёт работу.
 *
 * ПОЧЕМУ КАРТОЧКА ПРОПАДАЕТ ТОЛЬКО ПОСЛЕ ЗАКРЫТИЯ В «ГОТОВЫЕ». Пока вещь идёт по
 * конвейеру — в работе или на стикеровке — лист может понадобиться снова: сверить
 * номер, приложить к вещи, показать упаковщице. Как только заказ закрыт, вещь уехала
 * покупателю, и печатать лист повторно уже незачем — карточка исчезает сама.
 */
const InterceptedCutCard = ({ sewerId, sewerName, workshopId, visible }: Props) => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<KioskInterceptedOrder[]>([]);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!visible || !sewerId) {
      setOrders([]);
      return;
    }
    try {
      setOrders(await fetchInterceptedOrders(workshopId, sewerId));
    } catch {
      // Сеть моргнула — карточку не гасим по ошибке связи: работа никуда не делась.
    }
  }, [visible, sewerId, workshopId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!visible || !sewerId || orders.length === 0) return null;

  const handlePrint = async () => {
    setPrinting(true);
    try {
      // Позиции читаем ПРЯМО СЕЙЧАС: пока страница была открыта, часть вещей могла
      // закрыться — печатать их уже незачем.
      const sheet = await fetchInterceptedSheet(
        workshopId,
        orders.map((o) => o.id),
        sewerId,
      );
      if (sheet.length === 0) {
        toast({ title: 'Печатать нечего — заказы уже закрыты' });
        load();
        return;
      }
      // На компьютере швеи лист сохраняем файлом: его открывают и печатают когда
      // удобно, как и остальные листы на этой странице.
      await printCuttingSheet(sheet, sewerName || '', sewerId);
      // Отметка снимает напоминание на терминале: лист напечатан, кричать больше
      // не о чем. Ошибку показываем — иначе терминал продолжит звать впустую.
      await markInterceptedSheetPrinted(
        sheet.map((o) => o.id),
        sewerId,
        sewerName,
      );
      toast({ title: `Лист готов: ${sheet.length} поз.` });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось напечатать лист',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-amber-950">
      <div className="flex flex-wrap items-start gap-3">
        <Icon name="TriangleAlert" size={24} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-[14rem] flex-1">
          <p className="text-base font-bold">
            Перехваченный заказ у вас в работе
          </p>
          <p className="mt-0.5 text-sm">
            На вешалке бирка от отменённого заказа — напечатайте новый лист закройщика
          </p>
        </div>
        <Button
          variant="outline"
          disabled={printing}
          onClick={handlePrint}
          className="border-amber-500 bg-white"
        >
          <Icon name={printing ? 'Loader2' : 'Printer'} size={16} className="mr-2" />
          {printing ? 'Готовим лист…' : 'Напечатать лист'}
        </Button>
      </div>

      {/* Старый номер — первым: именно он написан на бирке, нового на ней нет. */}
      <ul className="mt-3 space-y-1.5 text-sm">
        {orders.map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded bg-white/70 px-3 py-1.5"
          >
            <span className="font-mono-tech font-bold">
              {o.cutFromOrderNumber || o.orderNumber}
            </span>
            <span className="text-amber-800">— это {o.orderNumber}</span>
            <span>
              {o.material || '—'} {o.width ?? '—'}×{o.height ?? '—'}
            </span>
            <span className="text-amber-800">{o.sewingStatus}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default InterceptedCutCard;
