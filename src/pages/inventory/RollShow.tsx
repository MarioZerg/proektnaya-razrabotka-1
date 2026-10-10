import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { fetchRollDetail, type RollDetail } from '@/lib/rollsApi';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import RollWriteOffDialog from '@/components/crm/rolls/RollWriteOffDialog';
import RollMoveDialog from '@/components/crm/rolls/RollMoveDialog';
import RollEditDialog from '@/components/crm/rolls/RollEditDialog';
import RollRemoveDialog from '@/components/crm/rolls/RollRemoveDialog';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import RollHeaderActions from '@/components/crm/rolls/show/RollHeaderActions';
import RollStockCards from '@/components/crm/rolls/show/RollStockCards';
import RollCostCard from '@/components/crm/rolls/show/RollCostCard';
import RollHistory from '@/components/crm/rolls/show/RollHistory';

const RollShow = () => {
  const { id } = useParams();
  const { user } = useAuth();
  // Закупочные цены — коммерческая тайна, их видит только администратор.
  const isAdmin = user?.role === 'admin';
  // Стикер рулона перепечатывают те, кто работает с рулонами руками: кладовщики
  // (включая старшего) и администратор. Производственным ролям это не нужно.
  const canPrintSticker = isAdmin || isStorekeeperRole(user?.role);
  const rollId = Number(id);
  const navigate = useNavigate();
  const [data, setData] = useState<RollDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  /** Цеха нужны для выбора смены при перемещении рулона. */
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopsError, setWorkshopsError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchRollDetail(rollId)
      .then((d) => {
        setError(null);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить рулон'))
      .finally(() => setLoading(false));
  }, [rollId]);

  useEffect(() => load(), [load]);

  const loadWorkshops = () => {
    fetchWorkshops()
      .then((list) => {
        setWorkshopsError(null);
        setWorkshops(list);
      })
      .catch((e) => {
        setWorkshopsError(e instanceof Error ? e.message : 'Не удалось загрузить цеха');
      });
  };

  // Список цехов грузим только администратору: перемещать рулон может он один.
  useEffect(() => {
    if (isAdmin) loadWorkshops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (loading && !data) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  if (error && !data) {
    return (
      <CrmLayout>
        <WarehouseFetchError
          title="Не удалось загрузить рулон"
          description={error}
          onRetry={load}
        />
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/crm/inventory/rolls')}>
          <Icon name="ChevronLeft" size={16} className="mr-1" />К рулонам
        </Button>
      </CrmLayout>
    );
  }

  if (!data) {
    return (
      <CrmLayout>
        <p className="text-sm text-destructive">Рулон не найден</p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => navigate('/crm/inventory/rolls')}>
          <Icon name="ChevronLeft" size={16} className="mr-1" />К рулонам
        </Button>
      </CrmLayout>
    );
  }

  const { roll, history } = data;
  // Расход, по которому нет ни одной записи: рулон перенесён из старой системы вместе
  // с остатком, а движения по заказам туда не переносились. Пишем об этом прямо,
  // иначе пустая история выглядит как пропавшие данные.
  const untracked = data.untrackedQuantity || 0;
  const usedQty = Math.max(0, roll.initialQuantity - roll.remainingQuantity);
  const usedPct = roll.initialQuantity > 0 ? Math.min(100, (usedQty / roll.initialQuantity) * 100) : 0;
  const remainPct = 100 - usedPct;
  const unit = roll.unit || '';

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/crm/inventory/rolls')}
            className="mb-2 -ml-2"
          >
            <Icon name="ChevronLeft" size={16} className="mr-1" />К рулонам
          </Button>
          <RollHeaderActions
            roll={roll}
            unit={unit}
            isAdmin={isAdmin}
            canPrintSticker={canPrintSticker}
            onWriteOff={() => setWriteOffOpen(true)}
            onMove={() => setMoveOpen(true)}
            onEdit={() => setEditOpen(true)}
            onRemove={() => setRemoveOpen(true)}
          />

          <RollEditDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            rollId={roll.id}
            barcode={roll.barcode}
            materialName={roll.materialName || 'Материал'}
            unit={unit}
            currentQuantity={roll.initialQuantity}
            onDone={load}
          />

          <RollRemoveDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            rollId={roll.id}
            barcode={roll.barcode}
            materialName={roll.materialName || 'Материал'}
            unit={unit}
            remainingQuantity={roll.remainingQuantity}
            onDone={() => navigate('/crm/inventory/rolls')}
          />

          <RollMoveDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            rollId={roll.id}
            barcode={roll.barcode}
            materialName={roll.materialName || 'Материал'}
            status={roll.status}
            workshopId={roll.workshopId}
            workshopName={roll.workshopName}
            shiftNumber={roll.shiftNumber}
            workshops={workshops}
            workshopsError={workshopsError}
            onRetryWorkshops={loadWorkshops}
            onDone={load}
          />
          <RollWriteOffDialog
            open={writeOffOpen}
            onOpenChange={setWriteOffOpen}
            rollId={roll.id}
            barcode={roll.barcode}
            materialName={roll.materialName || 'Материал'}
            remaining={roll.remainingQuantity}
            unit={unit}
            onDone={load}
          />

          <p className="mt-1 text-sm text-muted-foreground">
            {roll.materialName || 'Материал —'}
            {roll.materialType ? ` · ${roll.materialType}` : ''}
            {roll.workshopName ? ` · ${roll.workshopName}` : ''}
          </p>
        </div>

        <RollStockCards roll={roll} unit={unit} usedQty={usedQty} remainPct={remainPct} />

        {/* Себестоимость рулона — коммерческая информация, показываем ТОЛЬКО
            администратору. Закройщику и кладовщику знать закупочные цены не нужно. */}
        {isAdmin && roll.costPerUnit != null && (
          <RollCostCard roll={{ ...roll, costPerUnit: roll.costPerUnit }} unit={unit} />
        )}

        <RollHistory history={history} untracked={untracked} unit={unit} />
      </div>
    </CrmLayout>
  );
};

export default RollShow;
