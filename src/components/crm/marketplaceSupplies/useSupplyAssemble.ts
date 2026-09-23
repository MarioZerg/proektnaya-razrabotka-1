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
  setBoxItemCount,
  updateSupply,
  lockSupply,
  unlockSupply,
  moveSupplyStatus,
  CancelledOrderError,
  type SupplyDetail,
  type SupplyCandidate,
} from '@/lib/marketplaceSuppliesApi';
import { closeOzonBoxes, reopenOzonBox, fetchOzonBoxLabel } from '@/lib/ozonFboApi';
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
  // Какой короб закрывается прямо сейчас. Закрытие идёт по одному коробу и на
  // девяти занимает минуту: без счётчика экран выглядит зависшим, и кладовщик
  // жмёт кнопку повторно.
  const [closeProgress, setCloseProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
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

  // Кладовщик поправил количество одинакового товара в строке короба.
  // Уменьшение делаем одним запросом, а не серией удалений по одной вещи:
  // короб перезагружается один раз, и число на экране не «скачет».
  const handleSetItemCount = async (
    boxId: number,
    itemIds: number[],
    removeCount: number,
  ) => {
    try {
      await setBoxItemCount(boxId, itemIds, removeCount);
      toast({
        title:
          removeCount === 1
            ? 'Убрана 1 шт.'
            : `Убрано ${removeCount} шт.`,
        description: 'Товар вернулся на склад',
      });
      load();
      if (candidatesOpen) fetchSupplyCandidates(supplyId).then(setCandidates);
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  // Кладовщик закрыл короб и сразу увидел ошибку в составе — возвращаем короб
  // в работу. Грузоместо на OZON при этом снимается, иначе на приёмке окажется
  // лишнее место со старым составом.
  const handleReopenBox = async (boxId: number) => {
    try {
      const r = await reopenOzonBox(boxId);
      toast({
        title: `Короб №${r.boxNumber} снова открыт`,
        description:
          'Поправьте состав и закройте короб заново — придёт новая этикетка',
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось открыть короб',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
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
      // Задержка площадки — не повод пугать кладовщика: короб закрыт в любом
      // случае, а номер грузоместа и стикер подтянутся кнопкой «Получить
      // этикетку». Переоткрывать короб для этого НЕ нужно — при переоткрытии
      // место на OZON заводится заново, с другим номером, и уже наклеенные
      // стикеры пришлось бы переклеивать.
      toast({
        title: 'Короб закрыт',
        description: r.note || 'Грузоместо создано на OZON',
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

  /**
   * «Закрыть короба и получить стикеры» — ПРОХОДИМ КОРОБА ПО ОДНОМУ.
   *
   * ПОЧЕМУ НЕ ОДНИМ ЗАПРОСОМ НА ВСЮ ПОСТАВКУ. У функции на бэкенде около
   * пяти секунд, а один запрос к OZON занимает до пяти сам по себе: создание
   * грузоместа, ожидание номера, запрос этикетки и её скачивание в один
   * вызов не укладываются никогда. Пачка из девяти коробов обрывалась по
   * таймауту на середине — и в поставке оседало три короба, остальные
   * «не подтягивались», хотя физически стояли заклеенные на складе.
   *
   * Теперь кнопка делает ровно то же, что кладовщик руками: берёт короб,
   * закрывает его, дожидается стикера, берёт следующий. Каждый шаг —
   * отдельный короткий запрос, который успевает завершиться. Короб, уже
   * заведённый на OZON, пропускаем — второго грузоместа ему не нужно.
   *
   * Ход работы виден на кнопке: «Короб 4 из 9». Иначе на девяти коробах
   * экран замирает на минуту и выглядит зависшим.
   */
  const handleCloseBoxes = async () => {
    if (!supply) return;

    // Короба по порядку номеров: пустые не отправляем — грузоместо без товара
    // площадка не примет, а закрытых повторно не трогаем.
    const queue = supply.boxes
      .filter((b) => b.items.length > 0 && !b.ozonCargoId)
      .sort((a, b) => a.boxNumber - b.boxNumber);

    if (!queue.length) {
      toast({
        title: 'Закрывать нечего',
        description: 'Все непустые короба уже заведены на OZON',
      });
      return;
    }

    setClosingBoxes(true);
    let closed = 0;
    let stickers = 0;
    const failed: number[] = [];

    try {
      for (let i = 0; i < queue.length; i += 1) {
        const box = queue[i];
        setCloseProgress({ current: i + 1, total: queue.length });
        // ОДНА ПОВТОРНАЯ ПОПЫТКА НА КОРОБ.
        //
        // Самый частый отказ — лимит частоты OZON (429): площадка не любит
        // запросы подряд. Место при этом не создаётся, поэтому повтор
        // безопасен и дублей не даёт. Без него короб уходил в «не закрылись»
        // из-за секундной заминки площадки.
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
          try {
            await closeOzonBoxes(supplyId, box.id);
            ok = true;
          } catch (e) {
            if (attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 4000));
            }
          }
        }
        if (!ok) {
          // Короб так и не закрылся: остальные кладовщику нужно закрыть
          // сейчас, а про этот скажем в конце.
          failed.push(box.boxNumber);
          continue;
        }
        closed += 1;

        // Стикер OZON готовит асинхронно и на первый запрос почти всегда
        // отвечает «ещё не готово». Ждём его здесь же — кладовщик нажал одну
        // кнопку и должен получить готовую пачку, а не список недоделок.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const r = await fetchOzonBoxLabel(box.id);
          if (r.ready) {
            stickers += 1;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }

        // ПАУЗА ПЕРЕД СЛЕДУЮЩИМ КОРОБОМ.
        //
        // OZON жёстко ограничивает частоту: короба, отправленные подряд без
        // передышки, начинают получать отказ по лимиту. Полторы секунды между
        // коробами заметно снижают число таких отказов, а на девяти коробах
        // добавляют к общему времени меньше пятнадцати секунд.
        if (i < queue.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }

      toast({
        title: `Коробов закрыто: ${closed} из ${queue.length}`,
        description: failed.length
          ? `Стикеров получено: ${stickers}. Не закрылись короба: №${failed.join(', №')} — `
            + 'закройте их по одному из карточки короба'
          : `Стикеров получено: ${stickers} из ${closed}`
            + (stickers < closed
              ? '. По остальным нажмите «Получить этикетку» в коробе через минуту'
              : '. Можно печатать пачкой'),
        variant: failed.length ? 'destructive' : undefined,
      });
    } finally {
      setCloseProgress(null);
      setClosingBoxes(false);
      load();
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
    closeProgress,
    cargoType,
    lockedByOther,
    cancelledScan,
    setCancelledScan,
    handleAddBox,
    handleDeleteBox,
    handleAddOrderToBox,
    handleCloseBox,
    handleRemoveItem,
    handleSetItemCount,
    handleReopenBox,
    // Перечитать поставку — нужно экранам, которые меняют её в обход хука
    // (например, забрали этикетку короба у OZON).
    reload: load,
    handleCargoTypeChange,
    handleSupplyAssembled,
    handleCloseOzonBox,
    handleCloseBoxes,
    handleUploadSticker,
  };
};