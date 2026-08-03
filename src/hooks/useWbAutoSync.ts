import { useEffect, useRef } from 'react';
import { syncWbOrders } from '@/lib/wbFbsApi';
import { useToast } from '@/hooks/use-toast';

const INTERVAL_MS = 15 * 60 * 1000; // 15 минут

/** Фоновая автозагрузка новых FBS-заказов с WildBerries, пока открыта CRM.
 * Раз в 15 минут (и один раз при заходе) вызывает синхронизацию. Работает тихо:
 * уведомление показывается только когда реально созданы новые заказы. Ошибки не
 * всплывают (например, выключенная интеграция) — чтобы не мешать работе. */
export const useWbAutoSync = (enabled: boolean, actor?: { id?: number | null; name?: string | null }) => {
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
      try {
        const r = await syncWbOrders({ id: actorRef.current?.id, name: actorRef.current?.name });
        if (r.created > 0) {
          toast({
            title: `Новые заказы с WildBerries: ${r.created}`,
            description: 'Заказы автоматически добавлены в очередь производства.',
          });
        }
      } catch {
        // Тихо игнорируем: интеграция может быть выключена или временно недоступна.
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
