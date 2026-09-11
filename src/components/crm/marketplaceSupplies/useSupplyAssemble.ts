import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import {
  fetchSupplyDetail,
  fetchSupplyCandidates,
  createSupplyBox,
  deleteSupplyBox,
  closeSupplyBox,
  addOrderToBox,
  removeBoxItem,
  updateSupply,
  lockSupply,
  unlockSupply,
  moveSupplyStatus,
  CancelledOrderError,
  type SupplyDetail,
  type SupplyCandidate,
} from '@/lib/marketplaceSuppliesApi';
import { closeOzonBoxes } from '@/lib/ozonFboApi';
import { playScanSound, playScanErrorSound, playCancelSound } from '@/lib/scanSound';

/** Что показываем, когда отсканировали вещь отменённого заказа. */
export interface CancelledScanInfo {
  orderNumber?: string | null;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  storageBarcode?: string | null;
  marketplace?: string | null;
}

/**
 * Вся работа экрана сборки поставки: данные, блокировка поставки за кладовщиком
 * и действия с коробами.
 *
 * Вынесено из страницы отдельным хуком, чтобы разметку можно было читать без
 * трёхсот строк обработчиков перед ней. Логика перенесена один в один.
 */
export const useSupplyAssemble = (supplyId: number) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [supply, setSupply] = useState<SupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingBox, setAddingBox] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [candidates, setCandidates] = useState<SupplyCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const [closingBoxes, setClosingBoxes] = useState(false);
  const [cargoType, setCargoType] = useState<'BOX' | 'PALLET'>('BOX');

  // Поставку собирает кто-то другой: показываем предупреждение вместо рабочего экрана.
  const [lockedByOther, setLockedByOther] = useState<string | null>(null);

  // Отсканирована вещь отменённого заказа — показываем, что с ней делать.
  const [cancelledScan, setCancelledScan] = useState<CancelledScanInfo | null>(null);

  /**
   * Перечитать поставку.
   *
   * silent — обновление ПОСЛЕ скана. Экран «Загрузка…» в этот момент подменяет
   * собой всю страницу: коробы исчезают, поле ввода пересоздаётся и теряет
   * фокус, и кладовщик ждёт, пока всё вернётся. Сканер в это время стреляет в
   * пустоту. Поэтому при сканировании обновляем данные молча — картинка на
   * экране просто меняется на новую, поле остаётся живым.
   */
  const load = (silent = false) => {
    if (!silent) setLoading(true);
    fetchSupplyDetail(supplyId)
      .then((data) => {
        setSupply(data);
        setCargoType(data.ozonCargoType === 'PALLET' ? 'PALLET' : 'BOX');
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplyId]);

  /**
   * Занимаем поставку на время сборки.
   *
   * Двое кладовщиков в одной поставке ломают раскладку по коробам: каждый видит
   * свою картину экрана и кладёт заказы в чужие короба. Поэтому первый вошедший
   * забирает поставку себе, второй видит предупреждение.
   *
   * Раз в минуту продлеваем блокировку — сервер по этому сигналу понимает, что
   * человек ещё на месте. Если планшет разрядился или вкладку закрыли, через
   * 5 минут тишины поставка освободится сама и не останется занятой навсегда.
   */
  useEffect(() => {
    if (!supplyId) return;
    let alive = true;

    const take = async () => {
      try {
        await lockSupply(supplyId);
        if (alive) setLockedByOther(null);
      } catch (e) {
        if (alive) setLockedByOther(e instanceof Error ? e.message : 'Поставку собирает другой сотрудник');
      }
    };

    take();
    // Продлеваем блокировку только когда вкладка открыта. Свернул планшет и ушёл —
    // сигнал прекращается, и через 5 минут поставка освобождается для других.
    // Интервал НЕ замедляем ночью: если человек реально собирает поставку в ночную
    // смену, реже подтверждать нельзя — поставка уйдёт у него из-под рук.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') take();
    }, 60_000);

    return () => {
      alive = false;
      clearInterval(timer);
      // Уходим со страницы — отпускаем поставку, чтобы её сразу мог взять другой.
      unlockSupply(supplyId).catch(() => undefined);
    };
  }, [supplyId]);

  useEffect(() => {
    if (!candidatesOpen) return;
    setCandidatesLoading(true);
    fetchSupplyCandidates(supplyId)
      .then(setCandidates)
      .finally(() => setCandidatesLoading(false));
  }, [candidatesOpen, supplyId]);

  const handleAddBox = async () => {
    setAddingBox(true);
    try {
      await createSupplyBox(supplyId);
      toast({ title: 'Короб добавлен' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setAddingBox(false);
    }
  };

  const handleDeleteBox = async (boxId: number) => {
    try {
      await deleteSupplyBox(boxId);
      toast({ title: 'Короб удалён' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleAddOrderToBox = async (boxId: number, orderNumber: string) => {
    try {
      const res = await addOrderToBox(boxId, orderNumber);
      playScanSound();
      toast({ title: `Заказ ${orderNumber} добавлен в короб` });

      // СТРОКУ ДОРИСОВЫВАЕМ САМИ, БЕЗ ПЕРЕЗАПРОСА ПОСТАВКИ.
      //
      // Даже «тихая» перезагрузка тянула всю поставку целиком после каждого пика:
      // на большой поставке это секунды, за которые кладовщик успевает отсканировать
      // ещё пару вещей. Теперь сервер возвращает готовую строку — кладём её в нужный
      // короб, и картинка на экране совпадает с реальностью мгновенно.
      if (res.item) {
        const added = res.item;
        setSupply((prev) => {
          if (!prev) return prev;
          // Защита от гонки: тот же товар мог прилететь дважды (двойной пик сканера).
          if (
            prev.boxes.some((b) =>
              b.items.some((i) => i.goodsWarehouseId === added.goodsWarehouseId),
            )
          ) {
            return prev;
          }
          return {
            ...prev,
            boxes: prev.boxes.map((b) =>
              b.id === boxId ? { ...b, items: [...b.items, added] } : b,
            ),
          };
        });
      } else {
        // Сервер не прислал строку (нештатный случай) — падаем на прежнее
        // поведение, чтобы короба не разошлись с реальностью.
        load(true);
      }
      if (candidatesOpen) fetchSupplyCandidates(supplyId).then(setCandidates);
    } catch (e) {
      // ЗАКАЗ ОТМЕНЁН покупателем. Отдельный звук и отдельное окно: вещь едет не в
      // короб, а на полку хранения. Молчаливая ошибка тут не годится — кладовщик
      // сканирует подряд и уложил бы вещь в поставку, а площадка её не приняла бы.
      if (e instanceof CancelledOrderError) {
        playCancelSound();
        setCancelledScan(e.info);
        return;
      }
      playScanErrorSound();
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // WB FBO: закрываем короб в нашей системе (фиксируем closed_at), стикер печатается на фронте.
  const handleCloseBox = async (boxId: number) => {
    try {
      await closeSupplyBox(boxId);
      toast({ title: 'Короб закрыт', description: 'Печать стикера начнётся автоматически.' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleRemoveItem = async (itemId: number) => {
    try {
      await removeBoxItem(itemId);
      toast({ title: 'Товар убран из короба' });
      load();
      if (candidatesOpen) fetchSupplyCandidates(supplyId).then(setCandidates);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // Тип грузоместа (короб/палета) сохраняется в поставку и используется при закрытии коробов.
  const handleCargoTypeChange = async (value: 'BOX' | 'PALLET') => {
    setCargoType(value);
    try {
      await updateSupply(supplyId, { ozonCargoType: value });
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // ПОСТАВКА СОБРАНА: переводим её из «На сборке» в «Отгрузка».
  //
  // Это последний шаг кладовщика — дальше поставка уезжает, и вещи в неё уже не
  // кладут. Раньше кнопки не было вовсе: кладовщик закрывал короба и не понимал,
  // что делать дальше, а статус менял менеджер из списка поставок.
  const handleSupplyAssembled = async () => {
    setCompleting(true);
    try {
      await moveSupplyStatus(supplyId, 'Отгрузка');
      toast({
        title: 'Поставка собрана',
        description: 'Она перешла в отгрузку — вещи в неё больше не добавляются',
      });
      navigate(`/crm/shipments/to-marketplace/${supplyId}`);
    } catch (e) {
      toast({
        title: 'Не удалось завершить сборку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCompleting(false);
    }
  };

  // ЗАКРЫТИЕ ОДНОГО КОРОБА OZON FBO.
  //
  // Кладовщик работает коробами: набил — закрыл — наклеил этикетку — взял
  // следующий. Раньше закрыть можно было только всю поставку разом, в конце: к
  // тому моменту короба уже заклеены скотчем, и разложить по ним этикетки нечем.
  const handleCloseOzonBox = async (boxId: number) => {
    try {
      const r = await closeOzonBoxes(supplyId, boxId);
      toast({
        title: 'Короб закрыт',
        description:
          r.note ||
          (r.stickersSaved
            ? 'Стикер получен с OZON — можно печатать'
            : 'Грузоместо создано на OZON'),
      });
      load(true);
    } catch (e) {
      toast({
        title: 'Не удалось закрыть короб',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  // Закрытие коробов OZON FBO: создаёт грузоместа на OZON из состава каждого короба и тянет
  // PDF-этикетки. Действует на реальной заявке OZON.
  const handleCloseBoxes = async () => {
    setClosingBoxes(true);
    try {
      const r = await closeOzonBoxes(supplyId);
      toast({
        title: `Коробов закрыто: ${r.closedBoxes}`,
        description: r.note || `Стикеров получено: ${r.stickersSaved}. PDF-этикетки доступны в коробах.`,
      });
      load();
    } catch (e) {
      toast({ title: 'Не удалось закрыть короба', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setClosingBoxes(false);
    }
  };

  const handleUploadSticker = async (base64: string, fileName: string) => {
    try {
      await updateSupply(supplyId, { passStickerBase64: base64, passStickerName: fileName });
      toast({ title: 'Стикер пропуска загружен' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  return {
    navigate,
    supply,
    loading,
    addingBox,
    completing,
    candidatesOpen,
    setCandidatesOpen,
    candidates,
    candidatesLoading,
    closingBoxes,
    cargoType,
    lockedByOther,
    cancelledScan,
    setCancelledScan,
    handleAddBox,
    handleDeleteBox,
    handleAddOrderToBox,
    handleCloseBox,
    handleRemoveItem,
    handleCargoTypeChange,
    handleSupplyAssembled,
    handleCloseOzonBox,
    handleCloseBoxes,
    handleUploadSticker,
  };
};
