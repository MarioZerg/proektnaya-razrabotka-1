import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import {
  deleteRepairPiece,
  fetchRepairPieces,
  writeOffRepairPiece,
  type RepairPiece,
  type RepairPieceStatus,
} from '@/lib/repairFabricApi';
import StorekeeperSendToRepairDialog from '@/components/crm/goodsWarehouse/StorekeeperSendToRepairDialog';
import RepairFabricFilters from '@/components/crm/repairFabric/RepairFabricFilters';
import RepairPieceCards from '@/components/crm/repairFabric/RepairPieceCards';
import RepairPieceTable from '@/components/crm/repairFabric/RepairPieceTable';

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
  const isStorekeeper = user?.role === 'storekeeper' || user?.role === 'senior_storekeeper';
  const canAddPiece = isAdmin || isStorekeeper;

  const [pieces, setPieces] = useState<RepairPiece[]>([]);
  const [summary, setSummary] = useState<Array<{ material: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<RepairPieceStatus | 'all'>('available');
  const [material, setMaterial] = useState('all');
  const [writingOff, setWritingOff] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const load = () => {
    setLoading(true);
    fetchRepairPieces({ status: tab })
      .then((r) => {
        setListError(null);
        setPieces(r.pieces);
        setSummary(r.summary);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить куски');
      })
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
        // Номер со стикера ищем первым: с этой бумажкой в руках человек
        // и приходит к таблице — «что это за кусок и куда он делся».
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.storageBarcode || '').toLowerCase().includes(q) ||
        (p.sourceOrderNumber || '').toLowerCase().includes(q) ||
        p.material.toLowerCase().includes(q) ||
        `${p.width}x${p.height}`.includes(q) ||
        `${p.width}×${p.height}`.includes(q) ||
        (p.reasonLabel || '').toLowerCase().includes(q) ||
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
        <div className="flex flex-wrap items-start justify-between gap-3">
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
          {canAddPiece && (
            <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => setAddOpen(true)}>
              <Icon name="Plus" size={16} className="mr-2" />
              Добавить кусок
            </Button>
          )}
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить куски"
            description={listError}
            onRetry={load}
          />
        )}

        <RepairFabricFilters
          summary={summary}
          tab={tab}
          setTab={setTab}
          material={material}
          setMaterial={setMaterial}
          materials={materials}
          isAdmin={isAdmin}
          search={search}
          setSearch={setSearch}
        />

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </p>
        ) : visible.length === 0 ? (
          listError ? null : (
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
              Куски появляются, когда упаковщица отправляет их с перепаковки или
              кладовщик забирает брак из утилизации
            </p>
          </div>
          )
        ) : (
          <>
            <RepairPieceCards
              visible={visible}
              isAdmin={isAdmin}
              writingOff={writingOff}
              deleting={deleting}
              handleWriteOff={handleWriteOff}
              handleDelete={handleDelete}
            />

            <RepairPieceTable
              visible={visible}
              isAdmin={isAdmin}
              writingOff={writingOff}
              deleting={deleting}
              handleWriteOff={handleWriteOff}
              handleDelete={handleDelete}
            />
          </>
        )}
      </div>
      <StorekeeperSendToRepairDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSent={load}
      />
    </CrmLayout>
  );
};

export default RepairFabric;
