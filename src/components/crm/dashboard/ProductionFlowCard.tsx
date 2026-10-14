import { useState } from 'react';
import Icon from '@/components/ui/icon';
import LiveCountBoard from '@/components/crm/LiveCountBoard';
import SceneImage from '@/components/crm/SceneImage';
import type { DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';

/**
 * Плитка движения производства — та же карточка, что станция склада товара.
 *
 * Сверху сцена этапа, снизу название и табло. При наведении карточка
 * приподнимается, картинка чуть приближается: видно, что это кнопка.
 */

const SCENES: { match: string; src: string; pos: string }[] = [
  // На узкой плитке object-cover режет кадр — позиционируем людей в кадре.
  // «Новые задания»: чуть ниже, чтобы на мобилке было видно — стоит у стола.
  { match: 'Новые задания', src: 'prod-new-jobs', pos: 'object-[50%_48%]' },
  { match: 'Раскроено', src: 'prod-cut-ready', pos: 'object-center' },
  { match: 'закрое', src: 'prod-cutting', pos: 'object-[50%_22%]' },
  { match: 'пошиве', src: 'prod-sewing', pos: 'object-[42%_20%]' },
  { match: 'стикеровк', src: 'prod-sticker', pos: 'object-[50%_16%]' },
];

const sceneOf = (label: string) => SCENES.find((s) => label.includes(s.match));

/** Длинные заголовки — мягкий перенос по слогу, без «к о н в е й е р». */
const matrixHeader = (column: string) => {
  if (column === 'конвейер') return <>кон{'\u00AD'}вейер</>;
  return column;
};

/** Таблица FBS/FBO — крупный текст, иначе на телефоне штуки не читаются. */
const Matrix = ({ matrix }: { matrix: NonNullable<DashboardWidgetData['matrix']> }) => (
  <div className="min-w-0 overflow-x-auto rounded-md border border-border/70">
    <div className="grid w-full grid-cols-[minmax(2.75rem,auto)_repeat(3,minmax(0,1fr))] text-sm leading-snug">
      <div className="bg-muted/60" />
      {matrix.columns.map((column) => (
        <div
          key={column}
          className="bg-muted/60 px-1 py-1.5 text-center text-xs font-medium leading-tight text-muted-foreground sm:px-1.5 sm:text-sm"
        >
          {matrixHeader(column)}
        </div>
      ))}
      {matrix.rows.flatMap((row) => [
        <div
          key={`${row.label}-name`}
          className={`border-t border-border/70 px-1.5 py-1.5 text-xs font-medium uppercase sm:text-sm ${
            row.label === 'всего' ? 'font-semibold' : ''
          }`}
        >
          {row.label}
        </div>,
        ...row.values.map((value, index) => (
          <div
            key={`${row.label}-${matrix.columns[index]}`}
            className={`border-t border-border/70 px-1.5 py-1.5 text-center text-base font-semibold tabular-nums sm:text-lg ${
              row.label === 'всего' ? 'font-bold' : ''
            }`}
          >
            {value}
          </div>
        )),
      ])}
    </div>
  </div>
);

const ProductionFlowCard = ({
  widget,
  loading,
  onOpen,
  onCapacity,
}: {
  widget: DashboardWidgetData;
  loading: boolean;
  onOpen: () => void;
  onCapacity?: () => void;
}) => {
  const [pressed, setPressed] = useState(false);
  const scene = sceneOf(widget.label);
  const alive = !loading && widget.value > 0;
  const shell = `group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-[#f7f4ee] text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:rounded-2xl ${
    pressed ? 'scale-[0.98]' : ''
  } ${alive ? 'border-violet-200' : 'border-border'} ${widget.spotlight ? 'prod-flow-split' : ''}`;

  const picture = scene && (
    <div
      className={`prod-flow-photo relative shrink-0 overflow-hidden bg-[#f4efe6] ${
        widget.spotlight ? 'prod-flow-photo-spotlight' : ''
      }`}
    >
      <SceneImage
        name={scene.src}
        className={scene.pos}
        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
      />
    </div>
  );

  const body = (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-1.5 px-2 py-2 sm:gap-2 sm:px-3 sm:py-3 ${
        widget.spotlight ? 'gap-2 px-3 py-3 sm:gap-2.5' : ''
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5 sm:gap-x-3 sm:gap-y-2">
        <div className={`min-w-0 flex-1 ${widget.spotlight ? 'basis-28' : 'basis-20 sm:basis-36'}`}>
          <p
            className={`font-bold leading-tight ${
              widget.spotlight ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'
            }`}
          >
            {widget.shortLabel || widget.label}
          </p>
          {widget.hint && (
            <p
              className={`mt-0.5 leading-tight text-muted-foreground ${
                widget.spotlight
                  ? 'block text-xs sm:mt-1 sm:text-sm'
                  : 'mt-0.5 hidden text-xs sm:mt-1 sm:block'
              }`}
            >
              {widget.hint}
            </p>
          )}
        </div>
        <LiveCountBoard
          value={widget.value}
          tone="violet"
          loading={loading}
          size={widget.spotlight ? 'md' : 'sm'}
        />
      </div>
      {widget.matrix && !loading && <Matrix matrix={widget.matrix} />}
      {widget.spotlight && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Открыть
            <Icon name="ArrowRight" size={14} />
          </button>
          {onCapacity && (
            <button
              type="button"
              onClick={onCapacity}
              className="inline-flex items-center rounded-md border bg-background px-3 py-2 text-sm font-medium"
            >
              Мощность
            </button>
          )}
        </div>
      )}
    </div>
  );

  const card = widget.spotlight ? (
    <div className={`${shell} cursor-default`}>
      {picture}
      {body}
    </div>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      aria-label={`${widget.label}: ${loading ? 'загрузка' : widget.value}`}
      className={shell}
    >
      {picture}
      {body}
    </button>
  );

  return (
    <div className={`prod-flow min-w-0 ${widget.spotlight ? 'col-span-full' : 'h-full'}`}>{card}</div>
  );
};

export default ProductionFlowCard;
