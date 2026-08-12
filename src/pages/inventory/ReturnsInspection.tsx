import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { printStorageStickers } from '@/lib/printStorageSticker';
import PlaceInspectedDialog from '@/components/crm/goodsWarehouse/PlaceInspectedDialog';
import {
  INSPECTION_STAGES,
  toneClass,
  toneIconClass,
} from '@/components/crm/goodsWarehouse/inspectionStages';
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

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Возвраты на осмотре — воронка из шести этапов.
 *
 * Одна вещь идёт по цепочке: приняли с возврата → передали упаковщицам → они осмотрели
 * → кладовщик забрал из цеха → положил на полку. Брак сворачивает на утилизацию.
 * Каждый виджет — это счётчик застрявшей работы: сразу видно, где образовался затор.
 *
 * Раньше весь этот путь был невидим: вещь уезжала в цех и «пропадала» до тех пор, пока
 * кто-нибудь не находил её на столе.
 */
const ReturnsInspection = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [counts, setCounts] = useState<InspectionCounts>(EMPTY_COUNTS);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [stage, setStage] = useState<InspectionStage>('fromReturn');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [acting, setActing] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [disposeReason, setDisposeReason] = useState('');
  // Полки для укладки прямо с разбора — грузим один раз при открытии страницы.
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState('');

  const isAdmin = user?.role === 'admin';
  // Раскладывать по полкам могут кладовщик и админ — это конец пути возврата.
  const canPlace = isAdmin || isStorekeeperRole(user?.role);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    fetchShelves().then(setShelves).catch(() => setShelves([]));
  }, []);

  const toggle = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const toggleAll = () =>
    setSelected((prev) => (prev.length === items.length ? [] : items.map((i) => i.id)));

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

  const current = INSPECTION_STAGES.find((s) => s.key === stage);

  return (
    <CrmLayout>
      <div className="space-y-6">
        {/* Возврат к складу — стрелкой над заголовком, как на других вложенных страницах.
            Раньше здесь стояла кнопка «Склад товара» в один ряд с рабочими действиями:
            навигация мешалась среди кнопок, которыми что-то делают. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/crm/inventory/goods-warehouse')}
          className="-ml-2 -mb-2"
        >
          <Icon name="ChevronLeft" size={16} className="mr-1" />
          К складу товара
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Возвраты на осмотре</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Путь возвращённой вещи от приёмки до полки
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Главное действие кладовщика на этой странице: забрать осмотренное
                с производства и разложить по полкам хранения. */}
            {canPlace && (
              <Button onClick={() => setPlaceOpen(true)}>
                <Icon name="Warehouse" size={16} className="mr-2" />
                Принять осмотренные возвраты на производстве
                {counts.inspected + counts.taken > 0
                  ? ` (${counts.inspected + counts.taken})`
                  : ''}
              </Button>
            )}
            {/* Кнопка «Забрать из цеха» убрана: она дублировала приёмку осмотренных.
                Там кладовщик сканирует те же стикеры, но сразу назначает полку — вещь
                доходит до места за одно действие. Отдельный шаг «забрал, полку назначу
                потом» только плодил вещи, висящие на руках. */}
          </div>
        </div>

        {/* Виджеты движения: клик переключает список ниже. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {INSPECTION_STAGES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(s.key)}
              className={`rounded-lg border p-3 text-left transition ${toneClass[s.tone]} ${
                stage === s.key ? 'ring-2 ring-primary ring-offset-1' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon name={s.icon} size={16} className={toneIconClass[s.tone]} />
                <span className="text-2xl font-bold">{counts[s.key]}</span>
              </div>
              <p className="mt-1 text-sm font-medium leading-tight">{s.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground leading-tight">{s.hint}</p>
            </button>
          ))}
        </div>

        {/* Действия по выбранным вещам — свои для каждого этапа. */}
        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <span className="text-sm font-medium">Выбрано: {selected.length}</span>

            {/* Разбирая привезённое с ПВЗ и принятое ранее, кладовщик отправляет часть
                вещей упаковщицам на осмотр — действие одинаковое для обоих этапов. */}
            {(stage === 'fromReturn' || stage === 'fromMarketplace') && (
              <>
                <Button size="sm" onClick={handleMoveToWorkshop} disabled={acting}>
                  <Icon name="Truck" size={16} className="mr-2" />
                  Переместить в цех на осмотр
                </Button>
                {/* Вещь вернулась в порядке — везти её к упаковщицам незачем. Раньше
                    с разбора был один путь, через цех, и годная вещь делала лишний круг
                    по производству. Полку выбирают тут же: вещь в руках, и второй заход
                    через «Разложить по полкам» не нужен. */}
                <Select value={shelfId} onValueChange={setShelfId}>
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue placeholder="Полка" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelves.map((sh) => (
                      <SelectItem key={sh.id} value={String(sh.id)}>
                        {sh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleToShelf}
                  disabled={acting || !shelfId}
                >
                  <Icon name="Boxes" size={16} className="mr-2" />
                  На полку + стикер
                </Button>
              </>
            )}

            {stage !== 'disposed' && stage !== 'toDispose' && (
              <>
                <Input
                  value={disposeReason}
                  onChange={(e) => setDisposeReason(e.target.value)}
                  placeholder="Причина утилизации"
                  className="h-9 w-56"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDispose}
                  disabled={acting}
                >
                  <Icon name="TriangleAlert" size={16} className="mr-2" />
                  На утилизацию
                </Button>
              </>
            )}

            {stage === 'toDispose' && isAdmin && (
              <Button size="sm" variant="destructive" onClick={handleClear} disabled={acting}>
                <Icon name="Trash2" size={16} className="mr-2" />
                Списать окончательно
              </Button>
            )}

            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Снять выделение
            </Button>
          </div>
        )}

        {stage === 'toDispose' && !isAdmin && (
          <p className="text-sm text-muted-foreground">
            Очистить утилизацию может только администратор
          </p>
        )}

        <div className="space-y-2">
          <h2 className="font-semibold">{current?.title}</h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Загрузка...
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">На этом этапе пусто</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selected.length === items.length && items.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead className="text-primary-foreground">Товар</TableHead>
                    <TableHead className="text-primary-foreground">Ткань</TableHead>
                    <TableHead className="text-primary-foreground">Размер</TableHead>
                    <TableHead className="text-primary-foreground">Кто осмотрел</TableHead>
                    <TableHead className="text-primary-foreground">Дата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id} className="hover:bg-muted/60">
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.includes(i.id)}
                          onCheckedChange={() => toggle(i.id)}
                        />
                      </TableCell>
                      <TableCell
                        className="cursor-pointer"
                        onClick={() => navigate(`/crm/inventory/goods/${i.id}`)}
                      >
                        <div className="font-medium">{i.product || 'Товар'}</div>
                        <div className="text-xs text-muted-foreground">
                          {i.orderNumber || '—'} · {i.storageBarcode}
                        </div>
                        {(i.disposeReason || i.lostReason) && (
                          <div className="text-xs text-destructive">
                            {i.disposeReason || i.lostReason}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{i.material || '—'}</TableCell>
                      <TableCell>
                        {i.width && i.height ? `${i.width}×${i.height}` : '—'}
                      </TableCell>
                      <TableCell>{i.inspectedByName || i.takenByName || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(i.inspectedAt || i.takenAt || i.receivedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <PlaceInspectedDialog
          open={placeOpen}
          onOpenChange={setPlaceOpen}
          onDone={() => load()}
        />
      </div>
    </CrmLayout>
  );
};

export default ReturnsInspection;