import Icon from '@/components/ui/icon';

interface StorekeeperTasksCollapsedProps {
  doneCount: number;
  total: number;
  allDone: boolean;
  blockingCount: number;
  onExpand: () => void;
}

/**
 * СВЁРНУТЫЙ ВИД — маленький кружок со счётчиком.
 *
 * Занимает угол вместо всей карточки, поэтому кнопки под ним снова доступны.
 * Нажатие разворачивает список обратно.
 */
const StorekeeperTasksCollapsed = ({
  doneCount,
  total,
  allDone,
  blockingCount,
  onExpand,
}: StorekeeperTasksCollapsedProps) => (
  <button
    type="button"
    onClick={onExpand}
    title={`Задания смены: выполнено ${doneCount} из ${total}`}
    className={`fixed top-16 right-3 z-40 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 shadow-lg backdrop-blur transition-colors sm:right-4 ${
      allDone
        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
        : blockingCount > 0
          ? 'border-amber-300 bg-amber-50 text-amber-800'
          : 'border-border bg-card text-foreground'
    }`}
  >
    <Icon
      name={allDone ? 'CircleCheckBig' : 'ClipboardList'}
      size={16}
      className="shrink-0"
    />
    <span className="text-xs font-bold tabular-nums">
      {doneCount}/{total}
    </span>
  </button>
);

export default StorekeeperTasksCollapsed;
