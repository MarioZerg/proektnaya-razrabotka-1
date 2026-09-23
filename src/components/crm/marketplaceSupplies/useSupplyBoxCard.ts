import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupplyBox, SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { fetchOzonBoxLabel } from '@/lib/ozonFboApi';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { printWbBoxLabel } from '@/lib/wbBoxLabel';
import { printBoxLabelFromUrl } from '@/lib/printMarketplaceLabel';

/** Строка списка: одинаковые вещи короба, схлопнутые в одну позицию. */
export interface GroupedBoxItem {
  key: string;
  title: string;
  goodsStatus: string;
  itemIds: number[];
  count: number;
}

interface UseSupplyBoxCardArgs {
  box: SupplyBox;
  supply: SupplyDetail;
  canEdit: boolean;
  open: boolean;
  onCloseOzonBox?: (boxId: number) => Promise<void>;
  onAddOrder: (boxId: number, orderNumber: string) => Promise<void>;
  onLabelFetched: () => void;
  onCloseBox: (boxId: number) => Promise<void>;
}

/**
 * Поведение короба поставки: сканирование, закрытие, этикетки, группировка.
 *
 * Вынесено из SupplyBoxCard без изменений — та же логика, те же имена. В самом
 * компоненте осталась только разметка, поэтому правку поведения теперь ищут
 * здесь, а не среди двухсот строк вёрстки.
 */
export const useSupplyBoxCard = ({
  box,
  supply,
  canEdit,
  open,
  onCloseOzonBox,
  onAddOrder,
  onLabelFetched,
  onCloseBox,
}: UseSupplyBoxCardArgs) => {
  const [orderNumber, setOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [fetchingLabel, setFetchingLabel] = useState(false);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  // Раскрыли короб — сразу ставим курсор в поле сканера, чтобы кладовщик
  // не тянулся к нему мышкой перед каждым пиком.
  useEffect(() => {
    if (open && canEdit && !box.closedAt) {
      // Ждём окончания анимации раскрытия, иначе фокус слетает.
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open, canEdit, box.closedAt]);

  // ДОЖИДАЕМСЯ ЭТИКЕТКИ САМИ, НЕ ЗАСТАВЛЯЯ ЖАТЬ КНОПКУ ПО КРУГУ.
  //
  // OZON готовит файл асинхронно и на первый запрос почти всегда отвечает
  // «ещё не готово». Раньше экран просто показывал «нажмите позже» — и
  // кладовщик жал снова и снова, а этикетка не появлялась.
  //
  // Теперь повторяем запрос сами, с паузами, пока файл не будет готов.
  // Сервер продолжает ОДНУ операцию (operation_id сохранён), поэтому
  // повторы не плодят задачи на стороне площадки.
  const handleFetchLabel = async () => {
    setFetchingLabel(true);
    try {
      // 6 заходов с паузой 3с — до ~20 секунд ожидания. Дольше держать
      // кладовщика у экрана бессмысленно: скажем, что файл задерживается.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const r = await fetchOzonBoxLabel(box.id);
        if (r.ready) {
          toast({
            title: `Этикетка короба №${box.boxNumber} получена`,
            description: 'Можно печатать',
          });
          onLabelFetched();
          return;
        }
        // Уперлись в лимит частоты — ждём дольше, иначе повторы бесполезны.
        const pause = r.note?.includes('частот') ? 8000 : 3000;
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
      toast({
        title: 'OZON пока не отдал этикетку',
        description:
          'Площадка задерживает файл. Нажмите «Получить этикетку» ещё раз через минуту — короб уже закрыт, ничего переделывать не нужно',
      });
    } catch (e) {
      toast({
        title: 'Не удалось получить этикетку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setFetchingLabel(false);
    }
  };

  // OZON FBO: закрываем короб — сервер создаёт грузоместо на OZON и тянет PDF
  // этикетки именно этого короба. Печатать её кладовщик будет кнопкой ниже.
  const handleCloseOzon = async () => {
    if (!onCloseOzonBox) return;
    setClosing(true);
    try {
      await onCloseOzonBox(box.id);
      // СРАЗУ ИДЁМ ЗА СТИКЕРОМ, НЕ ЗАСТАВЛЯЯ ЖАТЬ ВТОРУЮ КНОПКУ.
      //
      // Закрытие и этикетка разделены: обе операции в один запрос не
      // укладываются в отведённое функции время. Но для кладовщика это один
      // шаг — «закрыл короб, наклеил стикер». Он закрывал короб, видел, что
      // наклейки нет, и шёл искать причину, хотя надо было просто подождать
      // несколько секунд.
      //
      // Ошибку здесь не показываем: короб уже закрыт, и если площадка
      // задерживает файл, об этом скажет сам handleFetchLabel.
      await handleFetchLabel();
    } finally {
      setClosing(false);
    }
  };

  const handleCloseAndPrint = async () => {
    setClosing(true);
    try {
      await onCloseBox(box.id);
      await printWbBoxLabel(supply, box);
    } finally {
      setClosing(false);
    }
  };

  /**
   * ПОЛЕ НЕ БЛОКИРУЕМ — СКАНЕР БЫСТРЕЕ СЕТИ.
   *
   * Раньше на время запроса поле уходило в disabled: кладовщик пикал следующую
   * вещь, а ввод улетал в никуда — браузер не принимает текст в заблокированное
   * поле. При хорошем темпе так терялась каждая вторая вещь, и приходилось
   * сканировать медленно, дожидаясь ответа сервера.
   *
   * Теперь поле живёт всегда: значение очищается сразу (защита от повторной
   * отправки того же кода), а ответ сервера догоняет позже и дорисовывает строку.
   * Так же сделано в FBS — там сканируют подряд без пауз.
   */
  const handleAdd = async () => {
    const value = orderNumber.trim();
    if (!value) return;
    setOrderNumber('');
    setScanning(true);
    // Фокус возвращаем немедленно, не дожидаясь сервера: следующий пик сканера
    // должен попасть в поле, даже если предыдущий запрос ещё в пути.
    inputRef.current?.focus();
    try {
      await onAddOrder(box.id, value);
    } finally {
      setScanning(false);
      inputRef.current?.focus();
    }
  };

  // Автоотправка работает только у РАСКРЫТОГО короба: у свёрнутых поля нет,
  // и ловить ввод сканера им незачем.
  useScannerAutoSubmit(orderNumber, handleAdd, canEdit && open);

  const canScan = canEdit && !box.closedAt;

  /**
   * ПЕЧАТЬ СТИКЕРА КОРОБА — ОДНИМ ДЕЙСТВИЕМ, ОТКУДА БЫ НИ НАЖАЛИ.
   *
   * Кладовщик печатает стикер у стола с коробом в руках, и путь к кнопке был
   * длинный: раскрыть короб, пролистать весь список вещей вниз и только там
   * найти кнопку. На поставке в двадцать коробов это двадцать раскрытий и
   * двадцать прокруток — при том, что сам короб уже заклеен и трогать его
   * состав незачем.
   *
   * Поэтому печать живёт здесь, в общем поведении короба: одну и ту же
   * функцию зовут и кнопка в свёрнутой плашке, и кнопка внизу раскрытого
   * короба. Поведение у них обязано совпадать до мелочей — иначе кладовщик
   * получит разный результат в зависимости от того, куда нажал.
   *
   * Печатаем ТОЛЬКО своё грузоместо: в старых стикерах лежит полный файл
   * заявки со всеми коробами сразу.
   */
  const handlePrintSticker = async () => {
    if (!box.stickerUrl) return;
    setPrinting(true);
    try {
      // Передаём все короба поставки: по ним печать подписывает наклейку
      // «Короб N из M» — номером, под которым короб известен в цехе.
      await printBoxLabelFromUrl(
        box.stickerUrl,
        `Стикер короба №${box.boxNumber}`,
        box.ozonCargoId,
        supply.boxes.filter((b) => b.items.length > 0),
      );
    } catch (e) {
      toast({
        title: 'Не удалось напечатать стикер',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  /** Печать стикера короба WB — та же кнопка в плашке, но своя наклейка. */
  const handlePrintWbSticker = async () => {
    setPrinting(true);
    try {
      await printWbBoxLabel(supply, box);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать стикер',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  // ОДИНАКОВЫЙ ТОВАР — ОДНОЙ СТРОКОЙ С КОЛИЧЕСТВОМ.
  //
  // В коробе FBO лежат обезличенные вещи, и одного размера туда уходит по
  // десять-двадцать штук. Каждая занимала отдельную строку с номером складской
  // записи — короб на полсотни вещей превращался в простыню, по которой
  // невозможно сверить состав с заявкой.
  //
  // Номер складской записи кладовщику здесь не нужен: вещи взаимозаменяемы,
  // на приёмке считают штуки по артикулу. Поэтому схлопываем одинаковые в
  // строку «12 × Лен 300x255» — ровно то, что он сверяет глазами.
  //
  // Группируем по названию товара и статусу: вещь в статусе «Отгружен» и
  // «В коробе» — разные состояния, смешивать их в одну строку нельзя.
  const groupedItems = useMemo(() => {
    const map = new Map<
      string,
      { key: string; title: string; goodsStatus: string; itemIds: number[] }
    >();
    for (const item of box.items) {
      const title =
        item.product ||
        [item.material, item.width && item.height ? `${item.width}×${item.height}` : null]
          .filter(Boolean)
          .join(' ') ||
        item.orderNumber ||
        'Товар';
      const key = `${title}__${item.goodsStatus || ''}`;
      const row = map.get(key);
      if (row) {
        row.itemIds.push(item.id);
      } else {
        map.set(key, {
          key,
          title,
          goodsStatus: item.goodsStatus || '',
          itemIds: [item.id],
        });
      }
    }
    return [...map.values()].map((row) => ({ ...row, count: row.itemIds.length }));
  }, [box.items]);

  return {
    orderNumber,
    setOrderNumber,
    scanning,
    closing,
    // Наружу отдаём только флаг: включают его сами обработчики печати ниже,
    // чтобы состояние кнопок не разъехалось между плашкой и списком действий.
    printing,
    fetchingLabel,
    inputRef,
    canScan,
    groupedItems,
    handleCloseOzon,
    handleCloseAndPrint,
    handleAdd,
    handleFetchLabel,
    handlePrintSticker,
    handlePrintWbSticker,
  };
};

export default useSupplyBoxCard;