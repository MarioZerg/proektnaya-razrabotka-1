import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { printCuttingSheet } from '@/lib/printCuttingSheet';
import {
  fetchKioskCutters,
  fetchKioskCutterStack,
  logKioskCutterSheet,
  type KioskCutter,
} from '@/lib/kioskApi';

interface KioskCutterSheetScreenProps {
  /** Цех терминала: закройщики и их стеки у каждого цеха свои. */
  workshopId: number | null;
  /** Кто стоит у терминала — его фамилия подставляется в список первой. */
  currentUserId?: number;
}

/**
 * ПЕЧАТЬ ЛИСТА ЗАКРОЙЩИКА НА ТЕРМИНАЛЕ.
 *
 * Стек берётся на компьютере, а печатать лист приходится у принтера в цехе — и
 * раньше между этими двумя точками не было ничего: лист порвался, потерялся,
 * планшет сменили, кэш браузера очистили — и распечатать заново было нечем,
 * кнопка «Распечатать задание» жила только в той вкладке, где брали стек.
 *
 * Здесь закройщица выбирает себя в списке и печатает. Позиции читаются из базы
 * в момент нажатия, поэтому лист всегда соответствует РЕАЛЬНОМУ остатку работы:
 * раскроенное в него не попадает, а добранные заказы попадают сами.
 */
const KioskCutterSheetScreen = ({ workshopId, currentUserId }: KioskCutterSheetScreenProps) => {
  const { toast } = useToast();
  const [cutters, setCutters] = useState<KioskCutter[]>([]);
  const [loading, setLoading] = useState(true);
  const [printingId, setPrintingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setCutters(await fetchKioskCutters(workshopId));
    } catch (e) {
      toast({
        title: 'Не удалось загрузить список',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setCutters([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId]);

  const handlePrint = async (c: KioskCutter) => {
    setPrintingId(c.id);
    try {
      // Позиции читаем ПРЯМО СЕЙЧАС, а не из загруженного списка: пока экран был
      // открыт, закройщица могла раскроить часть стека или добрать заказ — лист
      // обязан показывать её текущую работу, иначе на бумаге окажутся вещи,
      // которые уже висят на вешалке.
      const stack = await fetchKioskCutterStack(c.id, workshopId);
      if (stack.orders.length === 0) {
        toast({
          title: 'Стек уже раскроен — печатать нечего',
          description: 'Возьмите новый стек в конвейере',
        });
        load();
        return;
      }
      // На терминале лист уходит сразу на принтер: скачанный PDF на планшете
      // пришлось бы искать в загрузках и открывать сторонней читалкой.
      await printCuttingSheet(stack.orders, stack.cutterName || c.name, c.id, 'print');
      logKioskCutterSheet(c.id, stack.orders.map((o) => o.id));
      toast({ title: `Лист отправлен на печать: ${stack.orders.length} поз.` });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось напечатать лист',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrintingId(null);
    }
  };

  // Свою фамилию закройщица должна видеть первой: в цехе смена из десятка человек,
  // и листать список у принтера с рулоном в руках неудобно.
  const sorted = [...cutters].sort((a, b) => {
    if (a.id === currentUserId) return -1;
    if (b.id === currentUserId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xl text-muted-foreground">
          Выберите себя — лист напечатается по вашему текущему стеку
        </p>
        {/* «Обновить список», а не просто «Обновить»: в шапке терминала рядом стоит
            кнопка обновления самого приложения, и две одинаковые подписи путали. */}
        <Button size="lg" variant="outline" className="h-14 shrink-0 px-6 text-lg" onClick={load}>
          <Icon name="RefreshCw" size={22} className="mr-2" />
          Обновить список
        </Button>
      </div>

      {loading && (
        <div className="py-16 text-center text-xl text-muted-foreground">Загружаем…</div>
      )}

      {!loading && sorted.length === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
          <p className="text-2xl font-bold">Никто не держит стек</p>
          <p className="mt-1 text-lg">
            Лист печатается по взятым в раскрой заказам — сначала возьмите стек в конвейере
            («Товары для пошива» → «Взять стек»)
          </p>
        </div>
      )}

      {/* Плитки под палец в перчатке: крупная фамилия, рядом число позиций,
          которые уйдут на лист. */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
        {sorted.map((c) => (
          <button
            key={c.id}
            disabled={printingId !== null}
            onClick={() => handlePrint(c)}
            className="flex items-center gap-4 rounded-xl bg-emerald-600 p-6 text-left text-white transition active:scale-95 disabled:opacity-60"
          >
            <Icon name={printingId === c.id ? 'Loader' : 'Printer'} size={48} />
            <div className="min-w-0 flex-1">
              {/* Фамилию не обрезаем многоточием: у половины смены имена длиннее
                  плитки, и «Привезенцева Елена Ал…» от «Привезенцевой Елены Ан…»
                  не отличить — закройщица напечатала бы чужой лист. Переносим. */}
              <div className="text-3xl font-bold leading-tight">{c.name}</div>
              <div className="mt-1 text-xl opacity-90">
                {printingId === c.id ? 'Готовим лист…' : `${c.count} поз. в раскрое`}
              </div>
            </div>
            {c.id === currentUserId && (
              <span className="rounded-full bg-white px-3 py-1 text-base font-bold text-emerald-700">
                Это я
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default KioskCutterSheetScreen;