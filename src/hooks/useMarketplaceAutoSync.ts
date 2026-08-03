import { useEffect, useRef } from 'react';
import { syncWbOrders } from '@/lib/wbFbsApi';
import { syncOzonOrders } from '@/lib/ozonFbsApi';
import { useToast } from '@/hooks/use-toast';

const INTERVAL_MS = 15 * 60 * 1000; // 15 минут

/** Фоновая автозагрузка новых FBS-заказов с маркетплейсов (WildBerries и OZON), пока
 * открыта CRM. Раз в 15 минут (и один раз при заходе) вызывает синхронизацию. Работает
 * тихо: уведомление показывается только когда реально созданы новые заказы. Ошибки не
 * всплывают (интеграция может быть выключена/недоступна) — чтобы не мешать работе. */
export const useMarketplaceAutoSync = (
  enabled: boolean,
  actor?: { id?: number | null; name?: string | null }
) => {
  const { toast } = useToast();
  const running = useRef(false);
  // Держим актуальные данные в ref, чтобы не пересоздавать интервал при каждом рендере.
  const actorRef = useRef(actor);
  actorRef.current = actor;

  useEffect(() => {
    if (!enabled) return;

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
      } finally {
        running.current = false;
      }
    };

    run();
    const timer = setInterval(run, INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
};
