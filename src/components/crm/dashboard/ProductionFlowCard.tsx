import { useState } from 'react';
import Icon from '@/components/ui/icon';
import LiveCountBoard from '@/components/crm/LiveCountBoard';
import type { DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';

/**
 * Плитка движения производства — та же карточка, что станция склада товара.
 *
 * Сверху сцена этапа, снизу название и табло. При наведении карточка
 * приподнимается, картинка чуть приближается: видно, что это кнопка.
 */

const SCENES: { match: string; src: string }[] = [
  { match: 'Новые задания', src: '/warehouse-stations/prod-new-jobs.jpg' },
  { match: 'Раскроено', src: '/warehouse-stations/prod-cut-ready.jpg' },
  { match: 'закрое', src: '/warehouse-stations/prod-cutting.jpg' },
  { match: 'пошиве', src: '/warehouse-stations/prod-sewing.jpg' },
  { match: 'стикеровк', src: '/warehouse-stations/prod-sticker.jpg' },
];

const sceneOf = (label: string) => SCENES.find((s) => label.includes(s.match))?.src;

const Matrix = ({ matrix }: { matrix: NonNullable<DashboardWidgetData['matrix']> }) => (
  <div className="min-w-0 overflow-x-auto rounded-md border border-border/70 text-[11px] leading-tight">
    <div className="grid w-full grid-cols-[minmax(2.25rem,auto)_repeat(3,minmax(0,1fr))]">
      <div className="bg-muted/60" />
      {matrix.columns.map((column) => (
        <div key={column} className="break-words bg-muted/60 px-1 py-1 text-center text-muted-foreground">
          {column}
        </div>
      ))}
      {matrix.rows.flatMap((row) => [
        <div
          key={`${row.label}-name`}
          className={`border-t border-border/70 px-1.5 py-1 ${row.label === 'всего' ? 'font-semibold' : ''}`}
        >
          {row.label}
        </div>,
        ...row.values.map((value, index) => (
          <div
            key={`${row.label}-${matrix.columns[index]}`}
            className={`border-t border-border/70 px-1 py-1 text-center tabular-nums ${
              row.label === 'всего' ? 'font-semibold' : ''
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
  const src = sceneOf(widget.label);
  const alive = !loading && widget.value > 0;
  const shell = `group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#f7f4ee] text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
    pressed ? 'scale-[0.98]' : ''
  } ${alive ? 'border-violet-200' : 'border-border'} ${widget.spotlight ? 'prod-flow-split' : ''}`;

  const picture = src && (
    <div className="prod-flow-photo relative shrink-0 overflow-hidden bg-[#f4efe6]">
      <img
        src={src}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
    </div>
  );

  const body = (
    <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-36">
          <p className="text-sm font-bold leading-tight">{widget.shortLabel || widget.label}</p>
          {widget.hint && (
            <p className="mt-1 text-xs leading-tight text-muted-foreground">{widget.hint}</p>
          )}
        </div>
        <LiveCountBoard value={widget.value} tone="violet" loading={loading} />
      </div>
      {widget.matrix && !loading && <Matrix matrix={widget.matrix} />}
      {widget.spotlight && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Открыть
            <Icon name="ArrowRight" size={13} />
          </button>
          {onCapacity && (
            <button
              type="button"
              onClick={onCapacity}
              className="inline-flex items-center rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium"
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
