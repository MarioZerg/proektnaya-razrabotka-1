import { useEffect, useRef } from 'react';
import { syncWbOrders } from '@/lib/wbFbsApi';
import { syncOzonOrders } from '@/lib/ozonFbsApi';
import { syncMarketplaceReturns } from '@/lib/marketplaceReturnsApi';
import { useToast } from '@/hooks/use-toast';

const INTERVAL_MS = 30 * 60 * 1000; // 30 минут
// Возвраты появляются реже заказов — тянем их раз в час, чтобы не дёргать API впустую.
const RETURNS_INTERVAL_MS = 60 * 60 * 1000;

/** Фоновая подгрузка с маркетплейсов, пока открыта CRM.
 *
 * ЗАКАЗЫ (enabled) сейчас ВЫКЛЮЧЕНЫ и тянутся только внешним планировщиком по расписанию:
 * так они приезжают круглосуточно, а не только когда кто-то открыл систему, и не грузятся
 * повторно с каждого открытого планшета. Загрузку заказов оставили здесь на случай, если
 * расписание понадобится подстраховать, — включается флагом.
 *
 * ВОЗВРАТЫ (returnsEnabled) по-прежнему подтягиваются раз в час.
 *
 * Первый прогон идёт сразу при заходе. Работает тихо: уведомление всплывает только когда
 * реально что-то создано. Ошибки не показываем — интеграция может быть выключена или
 * недоступна, и это не должно мешать работе. */
export const useMarketplaceAutoSync = (
  /** Тянуть новые FBS-заказы — нужно только тем, кто ведёт производство (админ). */
  enabled: boolean,
  actor?: { id?: number | null; name?: string | null },
  /** Тянуть заявки на возврат — нужно админу и кладовщику. */
  returnsEnabled = false
) => {
  const { toast } = useToast();
  const running = useRef(false);
  // Держим актуальные данные в ref, чтобы не пересоздавать интервал при каждом рендере.
  const actorRef = useRef(actor);
  actorRef.current = actor;

  useEffect(() => {
    if (!enabled && !returnsEnabled) return;

    const run = async () => {
      if (running.current) return;
      running.current = true;
      const a = { id: actorRef.current?.id, name: actorRef.current?.name };
      try {
        const wb = await syncWbOrders(a).catch(() => null);
        if (wb && wb.created > 0) {
          toast({
            title: `Новые заказы с WildBerries: ${wb.created}`,
            description: 'Заказы автоматически добавлены в очередь производства.',
          });
        }
        const ozon = await syncOzonOrders(a).catch(() => null);
        if (ozon && ozon.created > 0) {
          toast({
            title: `Новые заказы с OZON: ${ozon.created}`,
            description: 'Заказы автоматически добавлены в очередь производства.',
          });
        }
        // Автозагрузка идёт фоном каждые 15 минут — о задвоении нужно узнать сразу,
        // иначе лишние вещи уйдут в раскрой и спишут материал повторно.
        if (ozon && ozon.duplicates && ozon.duplicates.length > 0) {
          toast({
            title: `Задвоение заказов OZON: ${ozon.duplicates.length}`,
            description: `Проверьте отправления: ${ozon.duplicates
              .map((d) => d.postingNumber)
              .join(', ')}`,
            variant: 'destructive',
          });
        }
      } finally {
        running.current = false;
      }
    };

    const runReturns = async () => {
      const a = { id: actorRef.current?.id, name: actorRef.current?.name };
      const res = await syncMarketplaceReturns(30, a.id ?? undefined, a.name ?? undefined).catch(
        () => null
      );
      if (res && res.created > 0) {
        toast({
          title: `Новые возвраты с маркетплейсов: ${res.created}`,
          description: 'Проверьте заявки в разделе «Получение возвратов».',
        });
      }
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    let returnsTimer: ReturnType<typeof setInterval> | null = null;

    if (enabled) {
      run();
      timer = setInterval(run, INTERVAL_MS);
    }
    if (returnsEnabled) {
      runReturns();
      returnsTimer = setInterval(runReturns, RETURNS_INTERVAL_MS);
    }
    return () => {
      if (timer) clearInterval(timer);
      if (returnsTimer) clearInterval(returnsTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, returnsEnabled]);
};