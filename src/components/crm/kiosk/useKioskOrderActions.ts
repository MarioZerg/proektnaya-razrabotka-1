import { recoverIfStaleBuild } from '@/lib/appUpdate';
import {
  type SpareItemError,
  storeSpareItem,
  confirmStorageLabelPrinted,
  closeKioskOrder,
  type KioskOrder,
} from '@/lib/kioskApi';
import { fetchOrderDetail } from '@/lib/ordersApi';
import { printFboSticker } from '@/lib/printFboSticker';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import { printLabelPng, printLabelPdf } from '@/lib/printMarketplaceLabel';
import { fetchWbLabel } from '@/lib/wbFbsApi';
import { fetchOzonLabel } from '@/lib/ozonFbsApi';
import { fetchYandexLabel } from '@/lib/yandexMarketApi';
import { playScanSound } from '@/lib/scanSound';

type Toast = (opts: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

interface Params {
  order: KioskOrder | null;
  setOrder: React.Dispatch<React.SetStateAction<KioskOrder | null>>;
  printed: boolean;
  setPrinted: (v: boolean) => void;
  labelRefused: boolean;
  setLabelRefused: (v: boolean) => void;
  setClosing: (v: boolean) => void;
  spare: SpareItemError['order'] | null;
  setSpare: (v: SpareItemError['order'] | null) => void;
  setStoringSpare: (v: boolean) => void;
  packerId: number;
  packerName: string;
  toast: Toast;
  /** Сброс экрана после закрытия заказа: снять заказ и вернуть фокус сканеру. */
  resetAfterClose: () => void;
  /** Вернуть фокус скрытому полю сканера. */
  refocus: () => void;
}

/**
 * Действия упаковщицы на терминале: напечатать стикер, закрыть заказ, сдать лишнюю вещь.
 *
 * Вынесено из экрана отдельно: это самая длинная часть работы терминала, и в ней
 * собраны все особые случаи — связки Яндекса, отменённые заказы, индивидуальный
 * пошив и вещи по уже закрытым заказам. Состояние остаётся на экране, здесь только
 * сама последовательность действий.
 */
export const useKioskOrderActions = ({
  order,
  setOrder,
  printed,
  setPrinted,
  labelRefused,
  setLabelRefused,
  setClosing,
  spare,
  setSpare,
  setStoringSpare,
  packerId,
  packerName,
  toast,
  resetAfterClose,
  refocus,
}: Params) => {
  const handlePrint = async () => {
    if (!order) return;
    try {
      // FBS: ярлык отправления печатает МАРКЕТПЛЕЙС — берём готовый файл по API и печатаем
      // как есть. Свой аналог рисовать нельзя: на складе принимают только их ярлык с их
      // кодами. FBO: маркетплейсного ярлыка нет, печатаем свой стикер товара.
      if (order.orderType === 'FBS') {
        const mp = (order.marketplace || '').toUpperCase();
        if (mp === 'WB') {
          printLabelPng(await fetchWbLabel(order.orderNumber), 'Стикер WB');
        } else if (mp === 'OZON') {
          await printLabelPdf(await fetchOzonLabel(order.orderNumber), 'Ярлык OZON');
        } else if (mp === 'YANDEX') {
          // СВЯЗКА ЯНДЕКСА: ярлык отправления ОДИН на весь заказ, а вещей в нём
          // несколько. Печатаем его только у ПОСЛЕДНЕЙ вещи — она уходит в пакет
          // сверху, ярлык клеится на этот пакет. Печатать его на каждой вещи
          // нельзя: одинаковых ярлыков наберётся четыре, и на складе площадки
          // посылку примут как четыре отправления вместо одного.
          //
          // На каждую вещь клеится стикер связки (YM-…) — он свой у каждой, и
          // именно им кладовщик собирает поставку.
          const inBundle = (order.groupSize || 0) > 1;
          const isLast = (order.groupPosition || 1) >= (order.groupSize || 1);
          if (!inBundle || isLast) {
            await printLabelPdf(await fetchYandexLabel(order.orderNumber), 'Ярлык Яндекс Маркета');
          } else {
            toast({
              title: `Вещь ${order.groupPosition} из ${order.groupSize} — ярлык не нужен`,
              description: 'Ярлык у связки один, он печатается на последней вещи',
            });
          }
        } else {
          printFboSticker(await fetchOrderDetail(order.id));
        }
      } else {
        // Для стикера нужны штрихкод/код OZON — берём полную карточку заказа.
        printFboSticker(await fetchOrderDetail(order.id));
      }
      setPrinted(true);
    } catch (e) {
      // Терминал открыт со старой версии, а её файлы на сервере уже заменены —
      // подгрузка кода печати падает. Забираем свежую версию сами: сотруднику
      // незачем разбираться в английских ошибках браузера.
      if (recoverIfStaleBuild(e)) {
        toast({ title: 'Обновляем систему…', description: 'Через миг повторите печать' });
        return;
      }
      // Маркетплейс отказал в ярлыке, потому что отправление уже уехало. Показываем
      // это как ситуацию, а не как сбой печати, и сразу открываем «Закрыть заказ»:
      // иначе вещь остаётся в цехе, а заказ навсегда висит в очереди стикеровки.
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('Ярлык не нужен')) {
        setOrder((prev) => (prev ? { ...prev, labelGone: true } : prev));
        setLabelRefused(true);
        toast({ title: 'Ярлык не нужен', description: msg });
        return;
      }
      toast({
        title: 'Не удалось напечатать стикер',
        description: msg || undefined,
        variant: 'destructive',
      });
    }
  };

  const handleClose = async () => {
    if (!order) return;
    setClosing(true);
    try {
      const res = await closeKioskOrder(
        order.id,
        packerId,
        packerId,
        packerName,
        // Ярлык напечатан и маркетплейс не отказал — вещь едет покупателю, а не на полку.
        printed && !labelRefused,
      );
      playScanSound();
      // Заказ отменён клиентом — вещь едет не покупателю, а на склад хранения. Печатаем
      // стикер ХРАНЕНИЯ: по нему кладовщик заберёт вещь из цеха и положит на полку.
      if (res.isCancelled && res.storageBarcode) {
        // Связка Яндекса: вещи заказа едут на склад по отдельности, но на полке их
        // нужно держать вместе. Пишем прямо на наклейке, что вещь из связки и какая
        // по счёту, — иначе одинаковые стикеры на полке не различить.
        const groupLabel =
          order.groupKey && (order.groupSize || 0) > 1
            ? `Связка ${order.groupPosition || 1} из ${order.groupSize}`
            : null;
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title: order.material && order.width
            ? `${order.material} ${order.width}×${order.height}`
            : order.product,
          orderNumber: order.orderNumber,
          groupLabel,
        });
        // Стикер ушёл на принтер — только теперь вещь встаёт в очередь «Разложить
        // по полкам». Пока стикера нет, звать кладовщика в цех не за чем: он придёт,
        // а вещь ещё у упаковщицы.
        void confirmStorageLabelPrinted(res.storageBarcode);
        toast({
          title: `Заказ ${order.orderNumber} отменён клиентом`,
          description: groupLabel
            ? `${groupLabel}. Наклейте стикер хранения и держите вещи связки вместе`
            : 'Наклейте стикер хранения — вещь заберёт кладовщик на полку',
        });
        resetAfterClose();
        return;
      }
      // Индивидуальный пошив на маркетплейс не едет: вещь до выдачи клиенту лежит
      // на полке. Печатаем свой стикер — с тканью, размерами и складским штрихкодом.
      if (res.isIndividual && res.storageBarcode) {
        printIndividualSticker({
          orderNumber: res.orderNumber || order.orderNumber,
          material: res.material ?? order.material,
          width: res.width ?? order.width,
          height: res.height ?? order.height,
          storageBarcode: res.storageBarcode,
          product: res.product ?? order.product,
        });
        void confirmStorageLabelPrinted(res.storageBarcode);
        toast({
          title: `Заказ ${order.orderNumber} закрыт`,
          description: 'Наклейте стикер и передайте вещь на полку хранения',
        });
        resetAfterClose();
        return;
      }
      // Связка Яндекса: каждая вещь стикеруется своим ярлыком по очереди. Говорим
      // упаковщице, сколько вещей заказа ещё не готово, — чтобы она не унесла пакет
      // и не отправила связку по частям. Когда осталось ноль, связка собрана целиком.
      if (res.groupSize && res.groupSize > 1) {
        const left = res.groupLeft ?? 0;
        // Стикер связки на КАЖДУЮ вещь. Ярлык площадки у связки один на всех, и
        // собрать им поставку нельзя — кладовщик сканирует именно этот код,
        // поэтому он должен быть на каждой вещи заказа.
        if (res.bundleBarcode) {
          printStorageSticker({
            storageBarcode: res.bundleBarcode,
            title:
              order.material && order.width
                ? `${order.material} ${order.width}×${order.height}`
                : order.product,
            orderNumber: order.orderNumber,
            groupLabel: `Связка ${res.groupPosition || 1} из ${res.groupSize}`,
          });
        }
        toast({
          title:
            left > 0
              ? `Вещь ${res.groupPosition} из ${res.groupSize} застикерована`
              : `Связка собрана полностью: ${res.groupSize} вещи`,
          description:
            left > 0
              ? `Наклейте стикер связки. Осталось ещё ${left} — не уносите пакет`
              : 'Все вещи заказа готовы — можно отправлять',
        });
      } else {
        toast({
          title: res.alreadyClosed
            ? `Заказ ${order.orderNumber} уже был закрыт`
            : `Заказ ${order.orderNumber} закрыт`,
          description: res.alreadyClosed
            ? 'Работа по нему уже принята — стикеровать заново не нужно'
            : 'Отправлен в «Готовые»',
        });
      }
      resetAfterClose();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setClosing(false);
    }
  };

  // Сдать лишнюю вещь на склад: печатаем стикер хранения и отдаём кладовщику.
  const handleStoreSpare = async () => {
    if (!spare) return;
    setStoringSpare(true);
    try {
      const res = await storeSpareItem(spare.id, packerId, packerName);
      printStorageSticker({
        storageBarcode: res.storageBarcode,
        title: [res.material, res.width && res.height ? `${res.width}x${res.height}` : null]
          .filter(Boolean)
          .join(' '),
        orderNumber: res.orderNumber,
      });
      void confirmStorageLabelPrinted(res.storageBarcode);
      toast({
        title: 'Вещь принята на склад',
        description: 'Наклейте стикер хранения и передайте вещь кладовщику',
      });
      setSpare(null);
      refocus();
    } catch (e) {
      toast({
        title: 'Не удалось сдать вещь',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setStoringSpare(false);
    }
  };

  return { handlePrint, handleClose, handleStoreSpare };
};
