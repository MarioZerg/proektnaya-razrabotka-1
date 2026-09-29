import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import WorkedDaySheet from '@/components/crm/finance/WorkedDaySheet';
import type { WorkedDay } from '@/components/crm/finance/workedDay';

interface WorkedDayOverlayProps {
  day: WorkedDay;
  onDone: () => void;
}

/**
 * Плашка отработанного дня поверх терминала сразу после закрытия смены.
 * Одна карточка на весь день: заказы строками, вычеты, надбавки и итог.
 */
const WorkedDayOverlay = ({ day, onDone }: WorkedDayOverlayProps) =>
  createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-6">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-bold">Смена закрыта</p>
            <p className="text-xs text-muted-foreground">Отработанный день</p>
          </div>
          <button
            type="button"
            onClick={onDone}
            className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Закрыть"
          >
            <Icon name="X" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <WorkedDaySheet day={day} large />
        </div>
        <div className="border-t border-border p-3">
          <Button className="h-12 w-full text-base" onClick={onDone}>
            Понятно
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );

export default WorkedDayOverlay;
