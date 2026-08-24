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
  closeSupplyBox,
  addOrderToBox,
  removeBoxItem,
  updateSupply,
  lockSupply,
  unlockSupply,
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

  // Поставку собирает кто-то другой: показываем предупреждение вместо рабочего экрана.
  const [lockedByOther, setLockedByOther] = useState<string | null>(null);

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
      await addOrderToBox(boxId, orderNumber);
      playScanSound();
      toast({ title: `Заказ ${orderNumber} добавлен в короб` });
      // Молча: без подмены экрана «Загрузка…» — кладовщик сканирует дальше,
      // пока список обновляется сам.
      load(true);
      if (candidatesOpen) fetchSupplyCandidates(supplyId).then(setCandidates);
    } catch (e) {
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

  // Поставку уже собирает другой кладовщик — вместо рабочего экрана показываем
  // предупреждение. Так двое не разложат заказы по чужим коробам.
  if (lockedByOther) {
    return (
      <CrmLayout>
        <div className="mx-auto max-w-md space-y-5 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
            <Icon name="Lock" size={28} />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Поставка занята</h1>
            <p className="text-sm text-muted-foreground">{lockedByOther}</p>
            <p className="text-sm text-muted-foreground">
              Дождитесь, пока он закончит: одну поставку одновременно собирает только
              один сотрудник.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={() => navigate('/crm/shipments/to-marketplace')}>
              <Icon name="ArrowLeft" size={16} className="mr-2" />
              К списку поставок
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              <Icon name="RefreshCw" size={16} className="mr-2" />
              Проверить снова
            </Button>
          </div>
        </div>
      </CrmLayout>
    );
  }

  const canEdit = supply.status === 'Открытая' || supply.status === 'На сборке';
  const totalBoxedItems = supply.boxes.reduce((sum, b) => sum + b.items.length, 0);
  // Сколько ещё вещей нужно уложить в короба по заявке маркетплейса.
  const remainingToScan =
    supply.totalQuantityMarketplace != null
      ? Math.max(0, supply.totalQuantityMarketplace - totalBoxedItems)
      : 0;
  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  const isWbFbo = supply.marketplace === 'WB' && supply.type === 'FBO';
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
            Номер поставки: {supply.supplyNumber || 'не указан'} · Создана{' '}
            {formatDateTime(supply.createdAt)}
          </p>

          {/* Прогресс сборки: сколько уже в коробах и сколько ещё нести. Без этого
              кладовщик держал план поставки в голове и узнавал о недоборе только
              при попытке её закрыть. */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span>
              В коробах: <b>{totalBoxedItems}</b>
              {supply.totalQuantityMarketplace ? ` из ${supply.totalQuantityMarketplace}` : ''}
            </span>
            {remainingToScan > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-0.5 font-semibold text-amber-900">
                Осталось отсканировать: {remainingToScan}
              </span>
            ) : (
              supply.totalQuantityMarketplace != null && (
                <span className="rounded-full bg-emerald-100 px-3 py-0.5 font-semibold text-emerald-800">
                  Поставка собрана полностью
                </span>
              )
            )}
          </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3">
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
                  supply={supply}
                  canEdit={canEdit}
                  isWbFbo={isWbFbo}
                  onAddOrder={handleAddOrderToBox}
                  onRemoveItem={handleRemoveItem}
                  onDeleteBox={handleDeleteBox}
                  onCloseBox={handleCloseBox}
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