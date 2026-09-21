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
  fetchRepairPieces,
  writeOffRepairPiece,
  type RepairPiece,
  type RepairPieceStatus,
} from '@/lib/repairFabricApi';

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
 *     под какие заказы кусок ещё годится, плюс возможность списать.
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
              {tab === 'available' ? 'В цехе нет кусков на перешив' : 'Ничего не найдено'}
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
                    {p.status === 'available' ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        В цехе
                      </Badge>
                    ) : p.status === 'used' ? (
                      <Badge variant="secondary">Израсходован</Badge>
                    ) : (
                      <Badge variant="destructive">Списан</Badge>
                    )}
                  </div>
                  {p.usedOrderNumber && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Ушёл на заказ {p.usedOrderNumber}
                    </p>
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
                        {p.status === 'available' ? (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                            В цехе
                          </Badge>
                        ) : p.status === 'used' ? (
                          <Badge variant="secondary">Израсходован</Badge>
                        ) : (
                          <Badge variant="destructive">Списан</Badge>
                        )}
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
                          {p.status === 'available' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleWriteOff(p)}
                              disabled={writingOff === p.id}
                            >
                              <Icon
                                name={writingOff === p.id ? 'Loader2' : 'Trash2'}
                                size={14}
                                className={writingOff === p.id ? 'animate-spin' : ''}
                              />
                            </Button>
                          )}
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
