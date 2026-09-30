import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { printCuttingSheet } from '@/lib/printCuttingSheet';
import {
  fetchInterceptedSheet,
  markInterceptedSheetPrinted,
  type KioskInterceptedOrder,
} from '@/lib/kioskApi';

interface Props {
  orders: KioskInterceptedOrder[];
  workshopId: number | null;
  actorId?: number;
  actorName?: string;
  /** Перечитать список после печати — плашка должна погаснуть сразу. */
  onPrinted: () => void;
}

/**
 * ПЛАШКА «ПЕРЕХВАЧЕННЫЙ ЗАКАЗ В РАБОТЕ» НА ТЕРМИНАЛЕ.
 *
 * Висит НА ЛЮБОМ экране терминала, пока на перехваченный крой не напечатан новый
 * лист закройщика. Вместе с ней каждые пять минут звучит голос: швея за смену
 * почти не подходит к терминалу, и молчаливую надпись она бы не увидела.
 *
 * ПОЧЕМУ ВИДЯТ ВСЕ, А НЕ ТОЛЬКО ШВЕЯ. К терминалу в течение смены подходят
 * закройщик, упаковщица, бригадир — любой из них может нажать «Напечатать лист».
 * Ждать, пока швея дойдёт до экрана, значит держать вещь с чужой биркой до вечера.
 *
 * Номер на плашке — СТАРЫЙ, с бирки. Именно по нему вещь ищут на вешалке: новый
 * номер нигде не написан, пока лист не напечатан.
 */
const KioskInterceptedBanner = ({
  orders,
  workshopId,
  actorId,
  actorName,
  onPrinted,
}: Props) => {
  const { toast } = useToast();
  const [printing, setPrinting] = useState(false);

  if (orders.length === 0) return null;

  const handlePrint = async () => {
    setPrinting(true);
    try {
      // Позиции читаем ПРЯМО СЕЙЧАС: пока плашка висела, часть вещей могла уйти
      // на стикеровку, и печатать их уже незачем.
      const ids = orders.map((o) => o.id);
      const sheet = await fetchInterceptedSheet(workshopId, ids);
      if (sheet.length === 0) {
        toast({ title: 'Печатать нечего — вещи уже ушли дальше' });
        onPrinted();
        return;
      }
      // На терминале лист уходит сразу на принтер: скачанный PDF на планшете
      // пришлось бы искать в загрузках и открывать сторонней читалкой.
      await printCuttingSheet(sheet, 'Перехваченный крой', null, 'print');
      // Отметку ставим ТОЛЬКО по реально напечатанным позициям — иначе одна
      // печать заглушила бы напоминание и по вещам, которых на листе не было.
      await markInterceptedSheetPrinted(
        sheet.map((o) => o.id),
        actorId,
        actorName,
      );
      toast({ title: `Лист отправлен на печать: ${sheet.length} поз.` });
      onPrinted();
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
    <div className="mx-4 mb-4 rounded-xl border-4 border-amber-500 bg-amber-50 p-5 text-amber-950">
      <div className="flex flex-wrap items-center gap-4">
        <Icon name="TriangleAlert" size={48} className="shrink-0 text-amber-600" />
        <div className="min-w-[16rem] flex-1">
          <p className="text-3xl font-bold leading-tight">
            Перехваченный заказ в работе у швеи
          </p>
          <p className="mt-1 text-xl">
            Напечатайте новый лист закройщика — на вешалке бирка от отменённого заказа
          </p>
        </div>
        {/* Кнопка крупная и справа: к терминалу подходят в перчатках. */}
        <button
          disabled={printing}
          onClick={handlePrint}
          className="flex shrink-0 items-center gap-3 rounded-xl bg-amber-600 px-6 py-5 text-2xl font-bold text-white transition active:scale-95 disabled:opacity-60"
        >
          <Icon name={printing ? 'Loader' : 'Printer'} size={32} />
          {printing ? 'Готовим лист…' : 'Напечатать лист'}
        </button>
      </div>

      {/* Какие именно вещи ждут листа. Старый номер — первым и крупно: по нему
          вещь ищут на вешалке, нового на бирке пока нет нигде. */}
      <ul className="mt-4 space-y-2">
        {orders.slice(0, 5).map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-white/70 px-4 py-2 text-xl"
          >
            <span className="font-mono-tech text-2xl font-bold">
              {o.cutFromOrderNumber || o.orderNumber}
            </span>
            <span>
              {o.material || '—'} {o.width ?? '—'}×{o.height ?? '—'}
            </span>
            {o.sewerName && <span className="text-amber-800">швея {o.sewerName}</span>}
            <span className="text-amber-800">{o.sewingStatus}</span>
          </li>
        ))}
        {orders.length > 5 && (
          <li className="px-4 text-lg text-amber-800">
            и ещё {orders.length - 5} — все попадут на лист
          </li>
        )}
      </ul>
    </div>
  );
};

export default KioskInterceptedBanner;
