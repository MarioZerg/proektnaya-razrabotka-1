import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime } from '@/lib/dateUtils';
import {
  deleteRepairPiece,
  fetchRepairPieces,
  writeOffRepairPiece,
  type RepairPiece,
  type RepairPieceStatus,
} from '@/lib/repairFabricApi';

/**
 * Состояние куска одним значком.
 *
 * «Под заказ» — отдельное состояние, а не разновидность «израсходован»:
 * ткань ещё цела и её можно вернуть в цех, просто закройщица отложила её
 * под конкретную вещь. Раньше такого состояния не было вовсе, и кусок,
 * который только взяли в руки, уже числился потраченным.
 */
const StatusBadge = ({ status }: { status: RepairPieceStatus }) => {
  if (status === 'available') {
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">В цехе</Badge>;
  }
  if (status === 'reserved') {
    return <Badge className="bg-violet-600 text-white hover:bg-violet-600">Под заказ</Badge>;
  }
  if (status === 'used') return <Badge variant="secondary">Израсходован</Badge>;
  return <Badge variant="destructive">Списан</Badge>;
};

/**
 * КУСКИ НА ПЕРЕШИВ — остатки ткани в цехе.
 *
 * ЗАЧЕМ СТРАНИЦА. Раньше годный кусок «распускали» в рулон: метраж прибавлялся
 * к остатку, а сам отрез терял размеры. Понять, что физически лежит в цехе,
 * было невозможно — только обезличенные метры.
 *
 * Здесь кусок виден как вещь: материал, ширина, высота, кто отправил.
 *
 * ДВА ВИДА ОДНОЙ СТРАНИЦЫ:
 *   * закройщику — простая таблица остатков, чтобы понимать, что есть в цехе.
 *     Выбирают кусок они не здесь, а в карточке заказа, где система сама
 *     отбирает подходящие по размеру;
 *   * администратору — полная картина: кто отправил, когда, из какой смены,
 *     под какие заказы кусок ещё годится, плюс списание и удаление строк.
 *
 * СПИСАТЬ И УДАЛИТЬ — РАЗНОЕ. Списание говорит «кусок был, его испортили» и
 * остаётся в истории. Удаление убирает строку целиком — для случаев, когда
 * куска и не было: отправили по ошибке, задублировали, ошиблись в размерах.
 */
const RepairFabric = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [pieces, setPieces] = useState<RepairPiece[]>([]);
  const [summary, setSummary] = useState<Array<{ material: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<RepairPieceStatus | 'all'>('available');
  const [material, setMaterial] = useState('all');
  const [writingOff, setWritingOff] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    fetchRepairPieces({ status: tab })
      .then((r) => {
        setPieces(r.pieces);
        setSummary(r.summary);
      })
      .catch(() => setPieces([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const materials = useMemo(
    () => [...new Set(pieces.map((p) => p.material))].sort(),
    [pieces],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pieces.filter((p) => {
      if (material !== 'all' && p.material !== material) return false;
      if (!q) return true;
      return (
        p.material.toLowerCase().includes(q) ||
        `${p.width}x${p.height}`.includes(q) ||
        `${p.width}×${p.height}`.includes(q) ||
        (p.createdByName || '').toLowerCase().includes(q)
      );
    });
  }, [pieces, material, search]);

  const handleWriteOff = async (piece: RepairPiece) => {
    const reason = window.prompt(
      `Списать кусок ${piece.material} ${piece.width}×${piece.height}?\nУкажите причину:`,
    );
    if (reason === null) return;
    setWritingOff(piece.id);
    try {
      await writeOffRepairPiece(piece.id, reason);
      toast({ title: 'Кусок списан' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось списать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setWritingOff(null);
    }
  };

  /**
   * УДАЛИТЬ СТРОКУ ИЗ ТАБЛИЦЫ ПЕРЕШИВА НАСОВСЕМ.
   *
   * Это НЕ списание. Списание — учётное событие: кусок был, его испортили,
   * след остался в истории и в отчётах. Но в таблицу попадает и мусор:
   * упаковщица отправила вещь по ошибке, задублировала строку, завела кусок
   * с неверными размерами. Списывать такое нельзя — в отчётности появится
   * брак, которого не было. Такие строки админ убирает.
   *
   * Вещь, которую отправили в перешив с перепаковки, возвращается в очередь
   * перепаковки: иначе она исчезнет разом отовсюду.
   */
  const handleDelete = async (piece: RepairPiece) => {
    const ok = window.confirm(
      `Удалить из таблицы кусок ${piece.material} ${piece.width}×${piece.height}?\n\n` +
        'Строка пропадёт насовсем, в отчётах её не будет. ' +
        'Если кусок был и его испортили — используйте списание, а не удаление.',
    );
    if (!ok) return;
    setDeleting(piece.id);
    try {
      await deleteRepairPiece(piece.id);
      toast({ title: 'Кусок удалён из таблицы' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось удалить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Icon name="Scissors" size={24} className="text-violet-600" />
            Куски на перешив
          </h1>
          <p className="text-sm text-muted-foreground">
            Отрезы ткани, лежащие в цехе. Закройщик выбирает их в карточке заказа —
            система показывает только те, что подходят по размеру
          </p>
        </div>

        {/* Сводка по материалам — главное, что нужно закройщику: сколько
            чего есть в цехе, без вчитывания в строки. */}
        {summary.length > 0 && tab === 'available' && (
          <div className="flex flex-wrap gap-2">
            {summary.map((s) => (
              <button
                key={s.material}
                type="button"
                onClick={() => setMaterial(material === s.material ? 'all' : s.material)}
                className={`rounded-lg border-2 px-3 py-2 text-left transition ${
                  material === s.material
                    ? 'border-violet-500 bg-violet-50'
                    : 'border-border hover:border-violet-300'
                }`}
              >
                <p className="text-xl font-bold">{s.count}</p>
                <p className="text-xs text-muted-foreground">{s.material}</p>
              </button>
            ))}
          </div>
        )}

        {/* Историю (израсходованные, списанные) показываем только админу:
            закройщику важен текущий остаток, а не архив. */}
        {isAdmin && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as RepairPieceStatus | 'all')}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start">
              <TabsTrigger value="available">В цехе</TabsTrigger>
              {/* Закреплённые — это куски, которые закройщица отложила под заказ,
                  но ещё не разрезала. Их важно видеть отдельно: если вещь зависла,
                  отсюда понятно, какой отрез лежит без движения. */}
              <TabsTrigger value="reserved">Под заказ</TabsTrigger>
              <TabsTrigger value="used">Израсходованы</TabsTrigger>
              <TabsTrigger value="written_off">Списаны</TabsTrigger>
              <TabsTrigger value="all">Все</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Поиск: материал, размер, кто отправил"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-80"
          />
          {materials.length > 1 && material !== 'all' && (
            <Button variant="outline" size="sm" onClick={() => setMaterial('all')}>
              <Icon name="X" size={14} className="mr-1.5" />
              {material}
            </Button>
          )}
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </p>
        ) : visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Icon name="Scissors" size={32} className="mx-auto mb-2 text-muted-foreground" />
            <p className="font-medium">
              {tab === 'available'
                ? 'В цехе нет кусков на перешив'
                : tab === 'reserved'
                  ? 'Ни один кусок не закреплён за заказом'
                  : 'Ничего не найдено'}
            </p>
            <p className="text-sm text-muted-foreground">
              Куски появляются здесь, когда упаковщица отправляет их с перепаковки
            </p>
          </div>
        ) : (
          <>
            {/* Мобильные карточки: в цехе смотрят с телефона, таблица там не читается. */}
            <div className="space-y-2 md:hidden">
              {visible.map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {p.material} {p.width}×{p.height}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.createdByName || '—'} · {formatDateTime(p.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  {p.usedOrderNumber && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.status === 'reserved' ? 'Закреплён за заказом ' : 'Ушёл на заказ '}
                      {p.usedOrderNumber}
                    </p>
                  )}
                  {/* Удаление доступно и с телефона: админ чаще всего замечает
                      ошибочную строку, стоя в цехе, а не за компьютером. */}
                  {isAdmin && p.status !== 'used' && (
                    <div className="mt-2 flex gap-2">
                      {p.status !== 'written_off' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleWriteOff(p)}
                          disabled={writingOff === p.id}
                        >
                          <Icon name="Ban" size={14} className="mr-1.5" />
                          Списать
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(p)}
                        disabled={deleting === p.id}
                      >
                        <Icon
                          name={deleting === p.id ? 'Loader2' : 'Trash2'}
                          size={14}
                          className={`mr-1.5 ${deleting === p.id ? 'animate-spin' : ''}`}
                        />
                        Удалить
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Материал</TableHead>
                    <TableHead>Размер</TableHead>
                    <TableHead>Статус</TableHead>
                    {isAdmin && <TableHead>Кто отправил</TableHead>}
                    {isAdmin && <TableHead>Цех / смена</TableHead>}
                    <TableHead>Когда</TableHead>
                    {isAdmin && <TableHead>Куда ушёл</TableHead>}
                    {isAdmin && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.material}</TableCell>
                      <TableCell className="font-mono-tech">
                        {p.width}×{p.height}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      {isAdmin && <TableCell>{p.createdByName || '—'}</TableCell>}
                      {isAdmin && (
                        <TableCell className="text-sm text-muted-foreground">
                          {p.workshopName || '—'}
                          {p.shiftNumber ? ` · смена ${p.shiftNumber}` : ''}
                        </TableCell>
                      )}
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(p.createdAt)}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-sm">
                          {p.usedOrderNumber ? (
                            <span className="font-mono-tech">{p.usedOrderNumber}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {p.usedByName && (
                            <span className="block text-xs text-muted-foreground">
                              {p.usedByName}
                            </span>
                          )}
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {/* СПИСАТЬ — кусок был и испортился, след остаётся.
                                Раскроенный списывать нечего: ткань уже в вещи. */}
                            {(p.status === 'available' || p.status === 'reserved') && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Списать: кусок был, но испорчен или потерян"
                                onClick={() => handleWriteOff(p)}
                                disabled={writingOff === p.id}
                              >
                                <Icon
                                  name={writingOff === p.id ? 'Loader2' : 'Ban'}
                                  size={14}
                                  className={writingOff === p.id ? 'animate-spin' : ''}
                                />
                              </Button>
                            )}
                            {/* УДАЛИТЬ СТРОКУ — для мусора: ошибочная отправка,
                                дубль, неверные размеры. Израсходованный кусок не
                                трогаем: он уже вшит в заказ, и без него расход
                                этого заказа перестанет сходиться. */}
                            {p.status !== 'used' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                title="Удалить строку из таблицы насовсем"
                                onClick={() => handleDelete(p)}
                                disabled={deleting === p.id}
                              >
                                <Icon
                                  name={deleting === p.id ? 'Loader2' : 'Trash2'}
                                  size={14}
                                  className={deleting === p.id ? 'animate-spin' : ''}
                                />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default RepairFabric;