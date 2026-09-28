import { cn } from '@/lib/utils';
import RequestMaterialDialog from '@/components/crm/shipments/RequestMaterialDialog';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { TabValue } from './useToWorkshopState';

interface ToWorkshopHeaderProps {
  isProduction: boolean;
  isAdmin: boolean;
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  openCreate: () => void;
  dialogMaterials: Material[];
  reqMaterialIds: string[];
  setReqMaterialIds: (value: string[]) => void;
  reqComment: string;
  setReqComment: (value: string) => void;
  creating: boolean;
  onCreate: () => void;
  workshops: Workshop[];
  reqWorkshopId: string;
  setReqWorkshopId: (value: string) => void;
  reqShiftNumber: string;
  setReqShiftNumber: (value: string) => void;
  activeTab: TabValue;
  setActiveTab: (tab: TabValue) => void;
  newCount: number;
  completedCount: number;
}

/**
 * Шапка страницы "Отгрузка в цех": заголовок с подсказкой по роли, кнопка-диалог
 * заявки на материал и переключатель вкладок Новые/Завершённые.
 */
const ToWorkshopHeader = ({
  isProduction,
  isAdmin,
  createOpen,
  setCreateOpen,
  openCreate,
  dialogMaterials,
  reqMaterialIds,
  setReqMaterialIds,
  reqComment,
  setReqComment,
  creating,
  onCreate,
  workshops,
  reqWorkshopId,
  setReqWorkshopId,
  reqShiftNumber,
  setReqShiftNumber,
  activeTab,
  setActiveTab,
  newCount,
  completedCount,
}: ToWorkshopHeaderProps) => {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Отгрузка в цех</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {isProduction
              ? 'Запросите ткани — можно несколько сразу, кладовщик соберёт рулоны одним рейсом'
              : isAdmin
                ? 'Заявку создаёт сотрудник цеха или админ за цех → сборка рулонов сканированием → отправка → приём в цехе'
                : 'Заявку создаёт сотрудник цеха → сборка рулонов сканированием → отправка → приём в цехе'}
          </p>
        </div>
        {(isProduction || isAdmin) && (
          <RequestMaterialDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onOpenCreate={openCreate}
            materials={dialogMaterials}
            reqMaterialIds={reqMaterialIds}
            setReqMaterialIds={setReqMaterialIds}
            reqComment={reqComment}
            setReqComment={setReqComment}
            creating={creating}
            onCreate={onCreate}
            isAdmin={isAdmin}
            workshops={workshops}
            reqWorkshopId={reqWorkshopId}
            setReqWorkshopId={setReqWorkshopId}
            reqShiftNumber={reqShiftNumber}
            setReqShiftNumber={setReqShiftNumber}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { value: 'new', title: 'Новые', hint: 'В работе', count: newCount },
            { value: 'completed', title: 'Завершённые', hint: 'Приняты в цехе', count: completedCount },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'min-w-0 rounded-md border px-3 py-3 text-left transition-colors',
              activeTab === tab.value
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border bg-card hover:bg-muted/40'
            )}
          >
            <div className="text-sm font-semibold">{tab.title}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums leading-none">{tab.count}</div>
            <div className="mt-1.5 text-xs text-muted-foreground">{tab.hint}</div>
          </button>
        ))}
      </div>
    </>
  );
};

export default ToWorkshopHeader;
