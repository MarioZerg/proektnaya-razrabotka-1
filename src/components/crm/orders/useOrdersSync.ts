import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { syncWbOrders } from '@/lib/wbFbsApi';
import { syncOzonOrders, refreshAllOzonStatuses } from '@/lib/ozonFbsApi';
import { syncYandexOrders } from '@/lib/yandexMarketApi';

/**
 * Загрузка заказов с площадок и обновление статусов OZON.
 * Логика 1:1 перенесена из MarketplaceOrders.
 */
export const useOrdersSync = (
  user: { id?: number; name?: string } | null | undefined,
  load: () => void,
) => {
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [syncingOzon, setSyncingOzon] = useState(false);
  const [syncingYandex, setSyncingYandex] = useState(false);
  const [refreshingOzon, setRefreshingOzon] = useState(false);

  // Загрузка новых FBS-заказов с WildBerries через API. Создаёт их в системе со статусом
  // «Новые», чтобы конвейер производства их подхватил. Нераспознанные артикулы (нет товара
  // в справочнике) показываем отдельным предупреждением.
  const handleSyncWb = async () => {
    setSyncing(true);
    try {
      const r = await syncWbOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.skippedNoItem) parts.push(`без товара ${r.skippedNoItem}`);
      toast({
        title: r.sandbox ? 'WB (тестовый режим): загрузка завершена' : 'Заказы WB загружены',
        description: `Получено с WB: ${r.totalFromWb}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.article || u.nmId).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с WildBerries',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  // Загрузка новых FBS-заказов с OZON (только новые, требующие сборки). Работает в режиме
  // чтения — статусы на OZON не меняются. Нераспознанные артикулы показываем предупреждением.
  const handleSyncOzon = async () => {
    setSyncingOzon(true);
    try {
      const r = await syncOzonOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.skippedNoItem) parts.push(`без товара ${r.skippedNoItem}`);
      toast({
        title: 'Заказы OZON загружены',
        description: `Новых отправлений с OZON: ${r.totalFromOzon}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.ozonSku || u.offerId).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      // Задвоение — серьёзно: одна вещь попала в систему дважды, значит дважды спишется
      // материал и дважды начислится зарплата. Сообщаем сразу и называем отправления.
      if (r.duplicates && r.duplicates.length > 0) {
        const list = r.duplicates
          .map((d) => `${d.postingNumber} (в системе ${d.actual}, у OZON ${d.expected})`)
          .join('; ');
        toast({
          title: `Обнаружено задвоение заказов: ${r.duplicates.length}`,
          description: `Проверьте отправления — лишние вещи нужно отменить: ${list}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с OZON',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncingOzon(false);
    }
  };

  // Загрузка новых FBS-заказов с Яндекс Маркета. Вещи одного заказа покупателя связываются
  // в группу: ярлык на них общий, поэтому по цеху они едут вместе — один закройщик, одна швея.
  const handleSyncYandex = async () => {
    setSyncingYandex(true);
    try {
      const r = await syncYandexOrders({ id: user?.id, name: user?.name });
      const parts = [`создано ${r.created}`];
      if (r.skippedExisting) parts.push(`уже были ${r.skippedExisting}`);
      if (r.matchedFromStock) parts.push(`закрыто со склада ${r.matchedFromStock}`);
      toast({
        title: 'Заказы Яндекс Маркета загружены',
        description: `Заказов покупателей: ${r.orders.length}. ${parts.join(', ')}.`,
      });
      if (r.skippedNoItem > 0) {
        const arts = r.unmatched.map((u) => u.offerId || u.shopSku).filter(Boolean).join(', ');
        toast({
          title: `Не распознано товаров: ${r.skippedNoItem}`,
          description: `Добавьте артикулы в справочник товаров: ${arts}`,
          variant: 'destructive',
        });
      }
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить заказы с Яндекс Маркета',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncingYandex(false);
    }
  };

  // Разом обновляет статусы всех OZON-заказов (сборка/отгрузка/доставка/доставлен) — читает
  // актуальные статусы с OZON, ничего не двигая на его стороне.
  const handleRefreshOzonStatuses = async () => {
    setRefreshingOzon(true);
    try {
      const r = await refreshAllOzonStatuses();
      toast({
        title: 'Статусы OZON обновлены',
        description: `Проверено заказов: ${r.checked}, изменилось статусов: ${r.updated}.`,
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось обновить статусы OZON',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRefreshingOzon(false);
    }
  };

  return {
    syncing,
    syncingOzon,
    syncingYandex,
    refreshingOzon,
    handleSyncWb,
    handleSyncOzon,
    handleSyncYandex,
    handleRefreshOzonStatuses,
  };
};

export default useOrdersSync;
