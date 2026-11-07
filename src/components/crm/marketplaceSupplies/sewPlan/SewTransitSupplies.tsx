import Icon from '@/components/ui/icon';
import type { SewTransitSupply } from '@/lib/fboSewPlanApi';

/** «12.11 09:00» — дата размещения поставки на складе Ozon. */
export const transitWhen = (t: SewTransitSupply): string => {
  if (!t.date) return 'дата размещения не назначена';
  const [, m, d] = t.date.split('-');
  const past = t.date < new Date().toISOString().slice(0, 10);
  return `${past ? 'размещение было ' : 'размещение '}${d}.${m}${t.timeslot ? ` ${t.timeslot}` : ''}`;
};

interface SewTransitSuppliesProps {
  cluster: string;
  supplies: SewTransitSupply[];
  onOpenSupply: (id: number) => void;
}

/**
 * Что уже едет в кластер: наши поставки FBO, ещё не размещённые на складе Ozon.
 * Эти штуки уже вычтены из потребности — шить их второй раз не нужно.
 */
const SewTransitSupplies = ({ cluster, supplies, onOpenSupply }: SewTransitSuppliesProps) => {
  if (!supplies.length) return null;
  const total = supplies.reduce((n, t) => n + t.quantity, 0);
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950/40">
      <p className="flex items-center gap-2 font-medium">
        <Icon name="Truck" size={15} className="text-sky-700" />
        Уже в пути в «{cluster}»: {total} шт. — вычтено из потребности
      </p>
      <ul className="mt-2 space-y-1">
        {supplies.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-2 text-xs">
            <button
              type="button"
              onClick={() => onOpenSupply(t.id)}
              className="font-medium text-sky-800 underline-offset-2 hover:underline dark:text-sky-300"
            >
              Поставка №{t.number}
            </button>
            <span className="text-muted-foreground">
              {t.warehouse ? `${t.warehouse} · ` : ''}
              {t.quantity} шт. · {t.status} · {transitWhen(t)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SewTransitSupplies;
