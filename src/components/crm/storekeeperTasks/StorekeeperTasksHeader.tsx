import Icon from '@/components/ui/icon';

interface StorekeeperTasksHeaderProps {
  allDone: boolean;
  isDemo: boolean;
  doneCount: number;
  total: number;
  onToggleOpen: () => void;
  onCollapse: () => void;
}

/**
 * Шапка виджета: награда за закрытый список, заголовок со счётчиком, кнопка
 * сворачивания и полоса выполнения.
 */
const StorekeeperTasksHeader = ({
  allDone,
  isDemo,
  doneCount,
  total,
  onToggleOpen,
  onCollapse,
}: StorekeeperTasksHeaderProps) => (
  <>
    {/* НАГРАДА ЗА ЗАКРЫТЫЙ ЧЕК-ЛИСТ.
        Появляется, когда выполнено ВСЁ, и выскакивает над виджетом с лёгким
        перелётом. Дальше еле заметно покачивается — глаз не устаёт.
        Стоит появиться новой работе (пришёл возврат, отменили заказ) —
        картинка исчезает сама и вернётся, только когда список снова закрыт.
        pointer-events-none: не перехватывает клики по заданиям под ней. */}
    {allDone && (
      // Два слоя, потому что анимации разные по смыслу: внешний выскакивает
      // один раз, внутренний качается бесконечно. В одном элементе они
      // затирали бы друг друга — вторая анимация сбрасывала бы transform.
      <span
        aria-hidden
        className="pointer-events-none absolute -top-12 right-2 z-10 animate-cheer-pop motion-reduce:animate-none sm:-top-16"
      >
        <img
          src="/happy-done.png"
          alt=""
          className="h-16 w-auto animate-cheer-idle drop-shadow-[0_6px_12px_rgba(0,0,0,0.25)] motion-reduce:animate-none sm:h-24"
        />
      </span>
    )}
    <button
      type="button"
      onClick={onToggleOpen}
      className="flex w-full items-center gap-2 py-2.5 pl-3 pr-9 text-left"
    >
      <Icon
        name={allDone ? 'CircleCheckBig' : 'ClipboardList'}
        size={18}
        className={allDone ? 'shrink-0 text-emerald-600' : 'shrink-0 text-primary'}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight">
          Задания смены
          {isDemo && (
            <span className="ml-1 rounded-sm bg-muted px-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              демо
            </span>
          )}
        </span>
        <span className="block text-xs leading-tight text-muted-foreground">
          {allDone
            ? 'Всё выполнено — можно закрывать смену'
            : `Выполнено ${doneCount} из ${total}`}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-sm font-bold ${
          allDone
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-primary/10 text-primary'
        }`}
      >
        {doneCount}/{total}
      </span>
    </button>

    {/* Убрать виджет с дороги. Стоит поверх шапки-кнопки отдельным слоем:
        вложенная кнопка внутри кнопки недопустима в вёрстке, а вынести её
        в ряд — значит отобрать место у заголовка. */}
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onCollapse();
      }}
      title="Свернуть — чтобы не мешал нажимать кнопки под ним"
      className="absolute right-1.5 top-3 z-10 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon name="Minus" size={14} />
    </button>

    {/* Полоса выполнения: видно продвижение за день одним взглядом. */}
    <div className="mx-3 h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          allDone ? 'bg-emerald-500' : 'bg-primary'
        }`}
        style={{ width: `${(doneCount / total) * 100}%` }}
      />
    </div>
  </>
);

export default StorekeeperTasksHeader;
