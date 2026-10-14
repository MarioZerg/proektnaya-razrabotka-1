import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { ROLL_LOW_STOCK_THRESHOLD } from '@/components/crm/rolls/rollsShared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';

interface RollsFiltersProps {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  materialFilter: string;
  setMaterialFilter: (v: string) => void;
  workshopFilter: string;
  setWorkshopFilter: (v: string) => void;
  shiftFilter: string;
  setShiftFilter: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  /** Показывать только заканчивающиеся рулоны — те же, что в виджете на главной. */
  lowStockOnly: boolean;
  setLowStockOnly: (v: boolean) => void;
  /** Сколько всего рулонов заканчивается — цифра на кнопке фильтра. */
  lowStockCount: number;
  /** Материалы своей роли: закройщику тюль, швее тесьма, упаковщице пакеты. */
  filterMaterials: Material[];
  workshops: Workshop[];
  /** Цех, выбранный в фильтре: из него берём названия смен. */
  filterWorkshop: Workshop | undefined;
}

type Step = 'status' | 'material' | 'workshop' | 'shift';

const STATUS_LABELS: Record<string, string> = {
  all: 'Все статусы',
  in_storage: 'На складе',
  in_workshop: 'В цехе',
  completed: 'Завершён',
};

const choiceClass =
  'rounded-lg border border-border bg-background px-3 py-2.5 text-left text-sm font-medium transition hover:border-primary/40 hover:bg-muted/50';

/**
 * Снаружи — только поиск по штрихкоду и тревога «Заканчиваются».
 * Остальное (статус → материал → цех → смена) в одной кнопке, выбор по шагам.
 */
const RollsFilters = ({
  statusFilter,
  setStatusFilter,
  materialFilter,
  setMaterialFilter,
  workshopFilter,
  setWorkshopFilter,
  shiftFilter,
  setShiftFilter,
  search,
  setSearch,
  lowStockOnly,
  setLowStockOnly,
  lowStockCount,
  filterMaterials,
  workshops,
  filterWorkshop,
}: RollsFiltersProps) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('status');

  const activeCount = [
    statusFilter !== 'all',
    materialFilter !== 'all',
    workshopFilter !== 'all',
    shiftFilter !== 'all',
  ].filter(Boolean).length;

  const materialLabel =
    materialFilter === 'all'
      ? null
      : filterMaterials.find((m) => String(m.id) === materialFilter)?.name;
  const workshopLabel =
    workshopFilter === 'all'
      ? null
      : workshopFilter === 'none'
        ? 'Без цеха'
        : workshops.find((w) => String(w.id) === workshopFilter)?.name;
  const shiftLabel =
    shiftFilter === 'all' || !filterWorkshop
      ? null
      : filterWorkshop.shiftNames?.[Number(shiftFilter) - 1] || `Смена ${shiftFilter}`;

  const summaryParts = [
    statusFilter !== 'all' ? STATUS_LABELS[statusFilter] : null,
    materialLabel,
    workshopLabel,
    shiftLabel,
  ].filter(Boolean);

  const openWizard = () => {
    setStep('status');
    setOpen(true);
  };

  const closeWizard = () => setOpen(false);

  const resetAll = () => {
    setStatusFilter('all');
    setMaterialFilter('all');
    setWorkshopFilter('all');
    setShiftFilter('all');
    setStep('status');
  };

  const pickStatus = (v: string) => {
    setStatusFilter(v);
    setStep('material');
  };

  const pickMaterial = (v: string) => {
    setMaterialFilter(v);
    setStep('workshop');
  };

  const pickWorkshop = (v: string) => {
    setWorkshopFilter(v);
    setShiftFilter('all');
    // Смена есть только у конкретного цеха; «все» и «на складе» — конец пути.
    if (v === 'all' || v === 'none') {
      closeWizard();
      return;
    }
    setStep('shift');
  };

  const pickShift = (v: string) => {
    setShiftFilter(v);
    closeWizard();
  };

  const stepTitle: Record<Step, string> = {
    status: 'Статус рулона',
    material: 'Материал',
    workshop: 'Цех',
    shift: 'Смена',
  };

  const goBack = () => {
    if (step === 'material') setStep('status');
    else if (step === 'workshop') setStep('material');
    else if (step === 'shift') setStep('workshop');
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Icon
          name="Search"
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Поиск по штрихкоду"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Заканчивающиеся — отдельной кнопкой: это тревога, не обычный фильтр.
          Сюда же ведёт виджет с главной. */}
      <Button
        variant={lowStockOnly ? 'destructive' : 'outline'}
        onClick={() => setLowStockOnly(!lowStockOnly)}
        className="justify-start gap-2 sm:w-auto"
      >
        <Icon name={lowStockOnly ? 'Check' : 'AlertTriangle'} size={16} />
        <span className="truncate">
          Заканчиваются (&lt;{ROLL_LOW_STOCK_THRESHOLD}&nbsp;м)
        </span>
        {lowStockCount > 0 && (
          <span
            className={`ml-auto shrink-0 rounded-full px-1.5 text-xs font-bold sm:ml-1 ${
              lowStockOnly
                ? 'bg-destructive-foreground/20'
                : 'bg-destructive text-destructive-foreground'
            }`}
          >
            {lowStockCount}
          </span>
        )}
      </Button>

      <Button
        type="button"
        variant={activeCount > 0 ? 'secondary' : 'outline'}
        onClick={openWizard}
        className="justify-between gap-2 sm:w-auto"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon name="SlidersHorizontal" size={16} className="shrink-0" />
          <span className="min-w-0 truncate">
            {summaryParts.length > 0 ? summaryParts.join(' · ') : 'Фильтры'}
          </span>
        </span>
        {activeCount > 0 && (
          <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-xs font-bold text-primary">
            {activeCount}
          </span>
        )}
      </Button>

      {activeCount > 0 && (
        <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={resetAll}>
          <Icon name="X" size={14} className="mr-1" />
          Сбросить
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 pr-6">
              <span>{stepTitle[step]}</span>
              {step !== 'status' && (
                <Button type="button" variant="ghost" size="sm" onClick={goBack}>
                  Назад
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          {summaryParts.length > 0 && (
            <p className="text-xs text-muted-foreground">{summaryParts.join(' · ')}</p>
          )}

          <div className="flex flex-col gap-2">
            {step === 'status' &&
              (
                [
                  ['all', 'Все статусы'],
                  ['in_storage', 'На складе'],
                  ['in_workshop', 'В цехе'],
                  ['completed', 'Завершён'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`${choiceClass} ${
                    statusFilter === value ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => pickStatus(value)}
                >
                  {label}
                </button>
              ))}

            {step === 'material' && (
              <>
                <button
                  type="button"
                  className={`${choiceClass} ${
                    materialFilter === 'all' ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => pickMaterial('all')}
                >
                  Все материалы
                </button>
                {filterMaterials.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`${choiceClass} ${
                      materialFilter === String(m.id) ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => pickMaterial(String(m.id))}
                  >
                    {m.name}
                  </button>
                ))}
              </>
            )}

            {step === 'workshop' && (
              <>
                <button
                  type="button"
                  className={`${choiceClass} ${
                    workshopFilter === 'all' ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => pickWorkshop('all')}
                >
                  Все цеха
                </button>
                {/* Рулоны на складе цеху не принадлежат — отдельный пункт. */}
                <button
                  type="button"
                  className={`${choiceClass} ${
                    workshopFilter === 'none' ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => pickWorkshop('none')}
                >
                  Без цеха (на складе)
                </button>
                {workshops.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className={`${choiceClass} ${
                      workshopFilter === String(w.id) ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => pickWorkshop(String(w.id))}
                  >
                    {w.name}
                  </button>
                ))}
              </>
            )}

            {step === 'shift' && (
              <>
                <button
                  type="button"
                  className={`${choiceClass} ${
                    shiftFilter === 'all' ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => pickShift('all')}
                >
                  Все смены
                </button>
                {(filterWorkshop?.shiftNames || []).map((name, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`${choiceClass} ${
                      shiftFilter === String(idx + 1) ? 'border-primary bg-primary/5' : ''
                    }`}
                    onClick={() => pickShift(String(idx + 1))}
                  >
                    {name}
                  </button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RollsFilters;
