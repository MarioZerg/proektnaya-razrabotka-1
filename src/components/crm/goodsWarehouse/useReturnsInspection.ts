import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { printStorageStickers } from '@/lib/printStorageSticker';
import {
  fetchInspection,
  moveToWorkshop,
  toShelfFromInspection,
  sendToDispose,
  clearDisposed,
  type InspectionCounts,
  type InspectionItem,
  type InspectionStage,
} from '@/lib/goodsWarehouseApi';

const EMPTY_COUNTS: InspectionCounts = {
  fromMarketplace: 0,
  fromReturn: 0,
  atPackers: 0,
  inspected: 0,
  taken: 0,
  toDispose: 0,
  disposed: 0,
};

/** Данные и действия страницы «Возвраты на осмотре»: этапы, выбор строк, операции. */
export const useReturnsInspection = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [counts, setCounts] = useState<InspectionCounts>(EMPTY_COUNTS);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [stage, setStage] = useState<InspectionStage>('fromReturn');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [acting, setActing] = useState(false);
  const [disposeReason, setDisposeReason] = useState('');
  // Полки для укладки прямо с разбора — грузим один раз при открытии страницы.
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState('');
  /** Поиск по списку: сюда пикают стикер возврата с пакета. */
  const [search, setSearch] = useState('');

  const isAdmin = user?.role === 'admin';
  // Раскладывать по полкам могут кладовщик и админ — это конец пути возврата.

  const load = (nextStage: InspectionStage = stage) => {
    setLoading(true);
    fetchInspection(nextStage)
      .then((data) => {
        setCounts(data.counts);
        setItems(data.items);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(stage);
    setSelected([]);
    setSearch('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    fetchShelves().then(setShelves).catch(() => setShelves([]));
  }, []);

  const toggle = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  /**
   * Отбор строк по поиску. Кладовщик держит в руках пакет с ПВЗ и пикает наклеенный на
   * него стикер возврата — по нему вещь и находится. Ищем заодно по стикеру хранения,
   * номеру заказа, товару и материалу: пригодится, когда стикер порван и приходится
   * искать глазами по названию.
   */
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const query = norm(search);
  const visible = query
    ? items.filter((i) =>
        norm(
          [
            i.returnBarcode,
            i.storageBarcode,
            i.orderNumber,
            i.product,
            i.returnProductName,
            i.material,
            i.width && i.height ? `${i.width}x${i.height}` : '',
          ]
            .filter(Boolean)
            .join(' '),
        ).includes(query),
      )
    : items;

  const toggleAll = () =>
    setSelected((prev) => (prev.length === visible.length ? [] : visible.map((i) => i.id)));

  const handleMoveToWorkshop = async () => {
    setActing(true);
    try {
      const res = await moveToWorkshop(selected, user?.id, user?.name);
      toast({
        title: 'Передано в цех',
        description: `Упаковщицы получили вещей: ${res.moved}`,
      });
      setSelected([]);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось передать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  // Вещь приехала в порядке — в цех её везти незачем, сразу в очередь на укладку.
  // Кладём вещи на полку прямо здесь и сразу печатаем стикеры хранения.
  //
  // Раньше вещь уходила «ждать укладки» и второй раз всплывала в виджете «Разложить
  // по полкам»: кладовщик заново её сканировал и выбирал полку. Двойная работа — вещь
  // уже у него в руках, полку он знает.
  const handleToShelf = async () => {
    if (!shelfId) {
      toast({ title: 'Выберите полку', variant: 'destructive' });
      return;
    }
    setActing(true);
    try {
      const res = await toShelfFromInspection(selected, Number(shelfId), user?.id, user?.name);
      // Печатаем ОДНОЙ лентой, а не по стикеру на вещь: при выборе нескольких товаров
      // окна печати открывались стопкой друг на друга, и кладовщик закрывал их по одному.
      // Рулонный принтер режет ленту сам по границе наклеек.
      printStorageStickers(
        res.items.map((i) => ({
          storageBarcode: i.storageBarcode,
          title:
            i.material && i.width && i.height
              ? `${i.material} ${i.width}x${i.height}`
              : i.product || 'Возврат',
          orderNumber: i.orderNumber,
        }))
      );
      toast({
        title: `Положено на «${res.shelfName}»: ${res.moved}`,
        description:
          res.moved > 1
            ? `Лента из ${res.moved} стикеров отправлена на печать`
            : 'Стикер хранения отправлен на печать',
      });
      setSelected([]);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось положить на полку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  const handleDispose = async () => {
    if (!disposeReason.trim()) {
      toast({ title: 'Укажите причину утилизации', variant: 'destructive' });
      return;
    }
    setActing(true);
    try {
      const res = await sendToDispose(selected, disposeReason.trim(), user?.id, user?.name);
      toast({ title: 'На утилизацию', description: `Отправлено вещей: ${res.moved}` });
      setSelected([]);
      setDisposeReason('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  const handleClear = async () => {
    setActing(true);
    try {
      const res = await clearDisposed(selected, user?.id, user?.name);
      toast({ title: 'Утилизация очищена', description: `Списано вещей: ${res.cleared}` });
      setSelected([]);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось очистить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setActing(false);
    }
  };

  return {
    counts,
    items,
    stage,
    setStage,
    loading,
    selected,
    setSelected,
    acting,
    disposeReason,
    setDisposeReason,
    shelves,
    shelfId,
    setShelfId,
    search,
    setSearch,
    isAdmin,
    visible,
    toggle,
    toggleAll,
    handleMoveToWorkshop,
    handleToShelf,
    handleDispose,
    handleClear,
  };
};
