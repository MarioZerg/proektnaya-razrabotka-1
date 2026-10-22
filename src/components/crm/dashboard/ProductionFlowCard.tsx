import { useState } from 'react';

const MATRIX_OPEN_KEY = 'dash-flow-matrix-open';
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
    <div className="grid w-full grid-cols-[minmax(6.5rem,auto)_repeat(3,minmax(0,1fr))] text-sm leading-snug">
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
          className={`whitespace-nowrap border-t border-border/70 px-1.5 py-1.5 text-xs font-medium sm:text-sm ${
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
  // Путь товара по этапам свёрнут по умолчанию: на главной видна только строка
  // «всего». Выбор запоминаем — кто раскрыл, тот и дальше видит таблицу.
  const [matrixOpen, setMatrixOpen] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(MATRIX_OPEN_KEY) === '1',
  );
  const toggleMatrix = () =>
    setMatrixOpen((prev) => {
      window.localStorage.setItem(MATRIX_OPEN_KEY, prev ? '0' : '1');
      return !prev;
    });
  const totalRow = widget.matrix?.rows.find((row) => row.label === 'всего');
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
        sizes={
          widget.spotlight
            ? '(min-width: 640px) 640px, 100vw'
            : '(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw'
        }
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
      {widget.matrix && !loading && (
        <div className="min-w-0">
          <button
            type="button"
            onClick={toggleMatrix}
            aria-expanded={matrixOpen}
            className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1.5 text-left text-xs transition-colors hover:bg-background sm:text-sm"
          >
            <span className="font-medium">Где товар</span>
            {totalRow && widget.matrix.columns.length >= 3 && (
              <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-x-3 gap-y-0.5 tabular-nums text-muted-foreground">
                <span>
                  {widget.matrix.columns[0]} <b className="text-foreground">{totalRow.values[0]}</b>
                </span>
                <span>
                  {widget.matrix.columns[1]} <b className="text-foreground">{totalRow.values[1]}</b>
                </span>
              </span>
            )}
            <Icon
              name="ChevronDown"
              size={16}
              className={`shrink-0 transition-transform duration-300 ${matrixOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <div
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
              matrixOpen ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              <Matrix matrix={widget.matrix} />
            </div>
          </div>
        </div>
      )}
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
