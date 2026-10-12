import { useState } from 'react';
import LiveCountBoard, { type CountTone } from '@/components/crm/LiveCountBoard';
import SceneImage from '@/components/crm/SceneImage';

type SceneKind = 'receive' | 'shelves' | 'van' | 'returns' | 'stocktake' | 'picking';

export interface WarehouseStation {
  title: string;
  hint?: string;
  /** null — у станции нет счётчика, она всё равно кнопка. */
  count: number | null;
  /** Пока очередь не пришла, ноль не показываем: это выглядит как «работы нет». */
  loading?: boolean;
  tone: CountTone;
  scene: SceneKind;
  onClick: () => void;
}

const SCENE_SRC: Record<SceneKind, string> = {
  receive: 'station-receive-shutter',
  shelves: 'station-shelves-coat',
  van: 'station-van-hug-wide',
  returns: 'station-returns-one',
  stocktake: 'station-stocktake-coat',
  picking: 'station-picking-wall-dash',
};

/** На узкой картинке кадр широкий: держим в кадре людей, а не пустой край. */
const SCENE_POS: Record<SceneKind, string> = {
  receive: 'object-center',
  shelves: 'object-center',
  van: 'object-[58%_center]',
  returns: 'object-center',
  stocktake: 'object-center',
  picking: 'object-[70%_center]',
};

const StationCard = ({ station }: { station: WarehouseStation }) => {
  const [pressed, setPressed] = useState(false);
  const alive = station.count != null && station.count > 0 && !station.loading;

  return (
    <button
      type="button"
      onClick={station.onClick}
      disabled={station.loading}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      aria-label={
        station.count == null
          ? station.title
          : `${station.title}: ${station.loading ? 'загрузка' : station.count}`
      }
      className={`group flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-[#f7f4ee] text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        pressed ? 'scale-[0.98]' : ''
      } ${
        alive
          ? station.tone === 'cyan'
            ? 'border-cyan-300'
            : 'border-violet-200'
          : 'border-border'
      } ${station.loading ? 'cursor-wait' : 'cursor-pointer'}`}
    >
      <div className="relative h-40 w-full overflow-hidden bg-[#f4efe6] sm:aspect-video sm:h-auto">
        <SceneImage name={SCENE_SRC[station.scene]} className={SCENE_POS[station.scene]} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">{station.title}</p>
          {station.hint && (
            <p className="mt-1 text-xs leading-tight text-muted-foreground">{station.hint}</p>
          )}
        </div>
        {station.count != null && (
          <LiveCountBoard value={station.count} tone={station.tone} loading={station.loading} />
        )}
      </div>
    </button>
  );
};

/** Станции склада: на телефоне — столбик блоков, на широком экране — сетка. */
const WarehouseLiveStations = ({ stations }: { stations: WarehouseStation[] }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {stations.map((station) => (
      <StationCard key={station.title} station={station} />
    ))}
  </div>
);

export default WarehouseLiveStations;
