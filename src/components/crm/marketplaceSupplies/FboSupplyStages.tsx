import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { boxPackedCount } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import OzonFboApplicationCard from '@/components/crm/marketplaceSupplies/OzonFboApplicationCard';
import GazelkaShippingCard from '@/components/crm/marketplaceSupplies/GazelkaShippingCard';
import SupplyFboFieldsCard from '@/components/crm/marketplaceSupplies/SupplyFboFieldsCard';
import SupplyItemsSection from '@/components/crm/marketplaceSupplies/SupplyItemsSection';
import SupplySewingSection from '@/components/crm/marketplaceSupplies/SupplySewingSection';
import SupplyGroupsPanel from '@/components/crm/marketplaceSupplies/SupplyGroupsPanel';
import WbFboSupplyCard from '@/components/crm/marketplaceSupplies/WbFboSupplyCard';
import WaybillCard from '@/components/crm/marketplaceSupplies/WaybillCard';
import SupplyAcceptanceCard from '@/components/crm/marketplaceSupplies/SupplyAcceptanceCard';
import FboArticlesCheck from '@/components/crm/marketplaceSupplies/FboArticlesCheck';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import type { SupplyShowContentProps } from '@/components/crm/marketplaceSupplies/SupplyShowContent';

type StageId = 'request' | 'sewing' | 'assemble' | 'ship';

const STAGES: { id: StageId; title: string; who: string }[] = [
  { id: 'request', title: 'Заявка', who: 'Менеджер' },
  { id: 'sewing', title: 'Пошив', who: 'Менеджер' },
  { id: 'assemble', title: 'Сборка', who: 'Кладовщик' },
  { id: 'ship', title: 'Отгрузка', who: 'Оба' },
];

const SHIPPED = ['Отгрузка', 'Отгружено', 'Принята', 'Выполнена'];
const SEWN = ['Готовые', 'Со склада'];

const sewingActive = (supply: SupplyDetail) =>
  (supply.sewingOrders || []).filter((o) => !o.isCancelled);

/**
 * Какой шаг открыть сразу.
 *
 * Менеджер идёт по своей цепочке: заявка → пошив → документы, пока короба
 * собирает кладовщик. Кладовщик попадает на сборку, как только есть что
 * укладывать, и на отгрузку — когда поставка уже собрана.
 */
const pickStage = (supply: SupplyDetail, isManager: boolean): StageId => {
  if (SHIPPED.includes(supply.status)) return 'ship';

  const sewing = sewingActive(supply);
  const sewn = sewing.filter((o) => SEWN.includes(o.sewingStatus)).length;
  const hasIdentity = !!(supply.supplyNumber || supply.ozonApplicationNumber || supply.cluster);
  // Печать стикеров открывается кладовщику только когда есть и заявка, и ID отгрузки.
  const gazelkaReady = !!supply.gazelkaPlanId && !!supply.gazelkaId;

  if (isManager) {
    if (!hasIdentity || sewing.length === 0) return 'request';
    if (sewn < sewing.length) return 'sewing';
    if (!gazelkaReady) return 'ship';
    return 'assemble';
  }

  if (supply.status === 'На сборке' || supply.boxes.length > 0) return 'assemble';
  if (sewing.length > 0 && sewn === 0) return 'sewing';
  return 'assemble';
};

const stageFacts = (supply: SupplyDetail) => {
  const sewing = sewingActive(supply);
  const sewn = sewing.filter((o) => SEWN.includes(o.sewingStatus)).length;
  const hasIdentity = !!(supply.supplyNumber || supply.ozonApplicationNumber || supply.cluster);
  const boxed = supply.boxes.reduce((sum, b) => sum + boxPackedCount(b), 0);
  const closed = supply.boxes.filter((b) => b.closedAt).length;
  const articles = supply.fboArticles || [];
  const articleGap = articles.some((r) => r.inBoxes !== r.planned);
  const planned = supply.totalQuantityMarketplace;

  return {
    sewing,
    sewn,
    requestDone: hasIdentity && sewing.length > 0,
    sewingDone: sewing.length > 0 && sewn === sewing.length,
    assembleDone:
      SHIPPED.includes(supply.status) ||
      (supply.boxes.length > 0 &&
        closed === supply.boxes.length &&
        boxed > 0 &&
        !articleGap &&
        (planned == null || boxed >= planned)),
    shipDone: supply.status === 'Принята' || supply.status === 'Выполнена',
    requestText: !hasIdentity
      ? 'Нужны данные'
      : sewing.length === 0
        ? 'Нет состава'
        : supply.supplyNumber || supply.cluster || 'Состав есть',
    sewingText:
      sewing.length === 0
        ? 'Состава нет'
        : sewn === sewing.length
          ? 'Всё сшито'
          : `Сшито ${sewn} из ${sewing.length}`,
    assembleText: SHIPPED.includes(supply.status)
      ? 'Собрана'
      : supply.boxes.length === 0
        ? 'Коробов нет'
        : articleGap
          ? 'Есть расхождения'
          : `Закрыто ${closed} из ${supply.boxes.length}`,
    shipText:
      supply.status === 'Принята' || supply.status === 'Выполнена'
        ? supply.status
        : supply.gazelkaPlanId && supply.gazelkaId
          ? 'Газелька готова'
          : supply.gazelkaPlanId
            ? 'Нужна синхронизация'
            : 'Нужны документы',
  };
};

interface FboSupplyStagesProps {
  supply: SupplyDetail;
  supplyId: number;
  now: Date;
  readyGoods: GoodsWarehouseItem[];
  load: (silent?: boolean) => void;
  fields: SupplyShowContentProps['fields'];
  flags: SupplyShowContentProps['flags'];
  actions: SupplyShowContentProps['actions'];
  onNavigateAssemble: () => void;
}

/**
 * Поставка FBO по шагам.
 *
 * Раньше заявка, пошив, короба, Газелька и накладная висели одной лентой:
 * менеджер прокручивал короба, кладовщик — форму накладной. Теперь на экране
 * один шаг. Чужие шаги открываются по нажатию, свой подсвечен.
 */
const FboSupplyStages = ({
  supply,
  supplyId,
  now,
  readyGoods,
  load,
  fields,
  flags,
  actions,
  onNavigateAssemble,
}: FboSupplyStagesProps) => {
  const recommended = pickStage(supply, flags.isManager);
  const [stage, setStage] = useState<StageId>(recommended);
  const facts = stageFacts(supply);
  const statusText: Record<StageId, string> = {
    request: facts.requestText,
    sewing: facts.sewingText,
    assemble: facts.assembleText,
    ship: facts.shipText,
  };
  const done: Record<StageId, boolean> = {
    request: facts.requestDone,
    sewing: facts.sewingDone,
    assemble: facts.assembleDone,
    ship: facts.shipDone,
  };
  const stageIndex = STAGES.findIndex((s) => s.id === stage);
  const next = STAGES[stageIndex + 1];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Четыре шага.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STAGES.map((item, index) => {
            const selected = item.id === stage;
            const yours = item.id === recommended && !done[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStage(item.id)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:bg-muted/50',
                  done[item.id] && !selected && 'border-emerald-300 bg-emerald-50/60',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                      done[item.id]
                        ? 'bg-emerald-600 text-white'
                        : selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {done[item.id] ? <Icon name="Check" size={14} /> : index + 1}
                  </span>
                  <span className="font-semibold leading-tight">{item.title}</span>
                </span>
                <span className="text-xs text-muted-foreground">{item.who}</span>
                <span className="text-xs font-medium">{statusText[item.id]}</span>
                {yours && (
                  <span className="text-[11px] font-semibold text-primary">Ваш шаг</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {stage === 'request' && (
        <div className="space-y-4">
          {flags.isOzonFbo && (
            <OzonFboApplicationCard
              supply={supply}
              onImportComposition={flags.isManager ? actions.handleImportFboComposition : undefined}
              importing={actions.importingFbo}
              defaultOpen
            />
          )}
          {flags.isWbFbo && (
            <WbFboSupplyCard supply={supply} onReload={load} isManager={flags.isManager} />
          )}
          {!flags.isOzonFbo && !flags.isWbFbo && (
            <SupplyFboFieldsCard
              supply={supply}
              supplyNumber={fields.supplyNumber}
              setSupplyNumber={fields.setSupplyNumber}
              supplyBarcode={fields.supplyBarcode}
              setSupplyBarcode={fields.setSupplyBarcode}
              cluster={fields.cluster}
              setCluster={fields.setCluster}
              gazelkaId={fields.gazelkaId}
              setGazelkaId={fields.setGazelkaId}
              comment={fields.comment}
              setComment={fields.setComment}
              saving={actions.saving}
              onSave={actions.handleSaveFields}
            />
          )}
        </div>
      )}

      {stage === 'sewing' && (
        <SupplySewingSection
          orders={supply.sewingOrders || []}
          canAdd={flags.isManager && ['Открытая', 'На сборке'].includes(supply.status)}
          onAdd={() => actions.setAddOrdersOpen(true)}
          canRemove={flags.isManager && ['Открытая', 'На сборке'].includes(supply.status)}
          onRemove={actions.handleRemoveSewingOrder}
          defaultOpen
        />
      )}

      {stage === 'assemble' && (
        <div className="space-y-4">
          <FboArticlesCheck rows={supply.fboArticles || []} />
          <SupplyGroupsPanel
            groups={supply.groups || []}
            cancelledCount={supply.items.filter((i) => i.isCancelled).length}
          />
          <SupplyItemsSection
            supply={supply}
            supplyId={supplyId}
            canEditItems={flags.canEditItems}
            canRemoveItems={flags.canRemoveItems}
            readyGoods={readyGoods}
            scanOrderNumber={actions.scanOrderNumber}
            setScanOrderNumber={actions.setScanOrderNumber}
            scanning={actions.scanning}
            scanInputRef={actions.scanInputRef}
            onScanOrder={actions.handleScanOrder}
            onRemoveItem={actions.handleRemoveItem}
            onNavigateAssemble={onNavigateAssemble}
            onReload={load}
          />
        </div>
      )}

      {stage === 'ship' && (
        <div className="space-y-4">
          <SupplyAcceptanceCard
            supply={supply}
            now={now}
            isManager={flags.isManager}
            onReload={() => load(true)}
          />
          {(flags.isOzonFbo || flags.isWbFbo) && (
            <GazelkaShippingCard
              supply={supply}
              onReload={load}
              isManager={flags.isManager}
              gazelkaReady={flags.gazelkaReady}
            />
          )}
          <WaybillCard supply={supply} isManager={flags.isManager} />
        </div>
      )}

      {next && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setStage(next.id)}>
            Дальше: {next.title}
            <Icon name="ArrowRight" size={16} className="ml-1.5" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default FboSupplyStages;
