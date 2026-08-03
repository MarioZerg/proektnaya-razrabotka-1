import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchSupplyDetail,
  fetchSupplyCandidates,
  createSupplyBox,
  deleteSupplyBox,
  addOrderToBox,
  removeBoxItem,
  updateSupply,
  type SupplyDetail,
  type SupplyCandidate,
} from '@/lib/marketplaceSuppliesApi';
import {
  formatDateTime,
  marketplaceLogo,
  statusVariant,
} from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import { closeOzonBoxes } from '@/lib/ozonFboApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import SupplyBoxCard from '@/components/crm/marketplaceSupplies/SupplyBoxCard';
import SupplyCandidatesPanel from '@/components/crm/marketplaceSupplies/SupplyCandidatesPanel';
import PassStickerCard from '@/components/crm/marketplaceSupplies/PassStickerCard';

const MarketplaceSupplyAssemble = () => {
  const { id } = useParams();
  const supplyId = Number(id);
  const navigate = useNavigate();
  const { toast } = useToast();

  const [supply, setSupply] = useState<SupplyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingBox, setAddingBox] = useState(false);

  const [candidatesOpen, setCandidatesOpen] = useState(false);
  const [candidates, setCandidates] = useState<SupplyCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const [closingBoxes, setClosingBoxes] = useState(false);
  const [cargoType, setCargoType] = useState<'BOX' | 'PALLET'>('BOX');

  const load = () => {
    setLoading(true);
    fetchSupplyDetail(supplyId)
      .then((data) => {
        setSupply(data);
        setCargoType(data.ozonCargoType === 'PALLET' ? 'PALLET' : 'BOX');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      await addOrderToBox(boxId, orderNumber);
      playScanSound();
      toast({ title: `Заказ ${orderNumber} добавлен в короб` });
      load();
      if (candidatesOpen) fetchSupplyCandidates(supplyId).then(setCandidates);
    } catch (e) {
      playScanErrorSound();
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

  if (loading || !supply) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  const canEdit = supply.status === 'Открытая' || supply.status === 'На сборке';
  const totalBoxedItems = supply.boxes.reduce((sum, b) => sum + b.items.length, 0);
  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  // Закрывать короба можно, когда есть непустые короба (у OZON FBO это создаёт грузоместа на OZON).
  const canCloseBoxes = isOzonFbo && totalBoxedItems > 0;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/crm/shipments/to-marketplace/${supplyId}`)}
            className="mb-2 -ml-2"
          >
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К поставке
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Сборка поставки #{supply.id}</h1>
            <Badge className={statusVariant[supply.status]?.className}>{supply.status}</Badge>
            <span className={marketplaceLogo[supply.marketplace]?.className}>
              {marketplaceLogo[supply.marketplace]?.label || supply.marketplace}
            </span>
            <Badge variant="outline">{supply.type}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Номер поставки: {supply.supplyNumber || 'подгрузится через API маркетплейса'} · Создана{' '}
            {formatDateTime(supply.createdAt)}
          </p>
        </div>

        {supply.marketplace === 'WB' && (
          <PassStickerCard
            passStickerUrl={supply.passStickerUrl}
            passStickerName={supply.passStickerName}
            saving={!canEdit}
            onUpload={handleUploadSticker}
          />
        )}

        <SupplyCandidatesPanel
          open={candidatesOpen}
          onOpenChange={setCandidatesOpen}
          candidates={candidates}
          loading={candidatesLoading}
        />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Короба ({supply.boxes.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              {isOzonFbo && (
                <Select value={cargoType} onValueChange={(v) => handleCargoTypeChange(v as 'BOX' | 'PALLET')}>
                  <SelectTrigger className="h-9 w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BOX">Короб</SelectItem>
                    <SelectItem value="PALLET">Палета</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {canCloseBoxes && (
                <Button
                  size="sm"
                  className="bg-[#005BFF] text-white hover:bg-[#0047cc]"
                  onClick={handleCloseBoxes}
                  disabled={closingBoxes}
                >
                  <Icon
                    name={closingBoxes ? 'Loader2' : 'PackageCheck'}
                    size={14}
                    className={`mr-1 ${closingBoxes ? 'animate-spin' : ''}`}
                  />
                  Закрыть короба и получить стикеры
                </Button>
              )}
              {canEdit && (
                <Button size="sm" onClick={handleAddBox} disabled={addingBox}>
                  {addingBox ? (
                    <Icon name="Loader2" size={14} className="mr-1 animate-spin" />
                  ) : (
                    <Icon name="PackagePlus" size={14} className="mr-1" />
                  )}
                  Добавить короб
                </Button>
              )}
            </div>
          </div>

          {supply.boxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Коробов пока нет — нажмите «Добавить короб», чтобы начать сборку
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {supply.boxes.map((box) => (
                <SupplyBoxCard
                  key={box.id}
                  box={box}
                  canEdit={canEdit}
                  onAddOrder={handleAddOrderToBox}
                  onRemoveItem={handleRemoveItem}
                  onDeleteBox={handleDeleteBox}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default MarketplaceSupplyAssemble;