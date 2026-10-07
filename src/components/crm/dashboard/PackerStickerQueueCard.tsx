import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { usePolling } from '@/hooks/usePolling';
import { useAuth } from '@/context/AuthContext';
import { fetchLiveFloor, type LiveFloorData, type LiveOrder } from '@/lib/liveFloorApi';
import {
  formatMinutes,
  productLabel,
  shortName,
} from '@/components/crm/dashboard/liveFloor/liveFloorShared';

interface SewerPile {
  sewerId: number | null;
  name: string;
  count: number;
  oldestAt: string;
  fbsCount: number;
  items: LiveOrder[];
}

const POLL_MS = 20000;

const pileKey = (pile: SewerPile, index: number) =>
  pile.sewerId != null ? String(pile.sewerId) : `none-${index}`;

const buildPiles = (
  data: LiveFloorData,
  workshopId: number | null | undefined,
): SewerPile[] => {
  const inWs = (id: number | null) => workshopId == null || id == null || id === workshopId;
  const waiting = data.orders.filter(
    (o) => o.sewingStatus === 'Стикеровка' && inWs(o.workshopId),
  );
  const bySewer = new Map<number | string, LiveOrder[]>();
  waiting.forEach((o) => {
    const key = o.sewerUserId ?? 'none';
    const list = bySewer.get(key) || [];
    list.push(o);
    bySewer.set(key, list);
  });
  return [...bySewer.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((a, b) => (a.sewnAt || '').localeCompare(b.sewnAt || ''));
      const oldest = sorted[0];
      const sewerId = typeof key === 'number' ? key : oldest.sewerUserId;
      return {
        sewerId,
        name: sewerId != null ? data.names[String(sewerId)] || 'Швея' : 'Без швеи',
        count: items.length,
        oldestAt: oldest.sewnAt || '',
        fbsCount: items.filter((o) => o.orderType === 'FBS').length,
        items: sorted,
      };
    })
    .sort((a, b) => {
      if (!a.oldestAt) return 1;
      if (!b.oldestAt) return -1;
      return a.oldestAt.localeCompare(b.oldestAt);
    });
};

const sewerWord = (n: number) => {
  if (n % 10 === 1 && n % 100 !== 11) return 'швея';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return 'швеи';
  return 'швей';
};

/**
 * Кого упаковщице брать первой.
 *
 * Швеи сдают вещи на стикеровку в разное время, и на телефоне общий список
 * «на стикеровке» не говорит, чья пачка лежит дольше. Карточка собирает очередь
 * по швеям: сверху та, кто скинула раньше всех.
 *
 * Размер одной вещи в шапке не пишем — это чужая пачка, не эталон. Что лежит,
 * видно в раскрытом списке: номер заказа, материал и размер.
 */
const PackerStickerQueueCard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const workshopId = user?.activeWorkshopId ?? user?.workshopId ?? null;
  const [data, setData] = useState<LiveFloorData | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchLiveFloor()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  usePolling(load, POLL_MS, true);

  const piles = useMemo(() => (data ? buildPiles(data, workshopId) : []), [data, workshopId]);
  const total = piles.reduce((sum, p) => sum + p.count, 0);
  const first = piles[0];
  const rest = piles.slice(1, 5);
  const hidden = Math.max(0, piles.length - 5);

  if (!first) return null;

  const waitMs = first.oldestAt ? Date.now() - new Date(first.oldestAt).getTime() : 0;
  const stale = waitMs >= 90 * 60000;
  const warm = waitMs >= 40 * 60000;

  const openConveyor = (pile: SewerPile) => {
    const tab = encodeURIComponent('Стикеровка');
    const sewer = pile.sewerId != null ? `&employee=${pile.sewerId}` : '';
    navigate(`/crm/marketplace/sewing-items?tab=${tab}${sewer}`);
  };

  const toggle = (key: string) => setOpenKey((cur) => (cur === key ? null : key));

  return (
    <section
      className={`rounded-xl border p-3 shadow-none ${
        stale
          ? 'border-red-300 bg-red-50'
          : warm
            ? 'border-orange-300 bg-orange-50'
            : 'border-orange-200 bg-orange-50/70'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
            stale ? 'bg-red-600 text-white' : 'bg-orange-500 text-white'
          }`}
        >
          <Icon name="Tag" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold leading-tight text-orange-950">
            Кого брать на стикеровку
          </p>
          <p className="mt-0.5 text-xs leading-snug text-orange-900/80">
            {total} {total === 1 ? 'вещь ждёт' : 'шт ждут'} — сверху та швея, кто
            скинула раньше
          </p>
        </div>
      </div>

      <PileRow
        pile={first}
        index={0}
        waitLabel={first.oldestAt ? formatMinutes(waitMs) : 'только что'}
        open={openKey === pileKey(first, 0)}
        featured
        onToggle={() => toggle(pileKey(first, 0))}
        onOpenConveyor={() => openConveyor(first)}
      />

      {rest.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {rest.map((pile, i) => {
            const wait = pile.oldestAt ? Date.now() - new Date(pile.oldestAt).getTime() : 0;
            const key = pileKey(pile, i + 1);
            return (
              <li key={key}>
                <PileRow
                  pile={pile}
                  index={i + 1}
                  waitLabel={pile.oldestAt ? formatMinutes(wait) : '—'}
                  open={openKey === key}
                  onToggle={() => toggle(key)}
                  onOpenConveyor={() => openConveyor(pile)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && (
        <p className="mt-1 px-2 text-xs text-orange-800/80">
          ещё {hidden} {sewerWord(hidden)} в очереди
        </p>
      )}
    </section>
  );
};

const PileRow = ({
  pile,
  index,
  waitLabel,
  open,
  featured = false,
  onToggle,
  onOpenConveyor,
}: {
  pile: SewerPile;
  index: number;
  waitLabel: string;
  open: boolean;
  featured?: boolean;
  onToggle: () => void;
  onOpenConveyor: () => void;
}) => (
  <div
    className={
      featured
        ? 'mt-3 rounded-lg border border-orange-300 bg-white shadow-sm'
        : 'rounded-md'
    }
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`flex w-full items-start gap-2.5 px-3 text-left active:bg-orange-50 ${
        featured ? 'min-h-[3.25rem] py-2.5' : 'min-h-11 py-1.5'
      }`}
    >
      {featured ? (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-black text-white">
          1
        </span>
      ) : (
        <span className="w-5 shrink-0 pt-0.5 text-center text-xs font-bold text-orange-700">
          {index + 1}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <span
            className={`leading-tight text-orange-950 ${
              featured ? 'text-base font-extrabold' : 'truncate text-sm font-semibold'
            }`}
          >
            {shortName(pile.name)}
          </span>
          <span
            className={`shrink-0 tabular-nums text-orange-800 ${
              featured ? 'text-sm font-bold' : 'text-xs'
            }`}
          >
            {waitLabel}
          </span>
        </span>
        <span className="mt-0.5 block text-sm leading-snug text-orange-950">
          {pile.count} шт
          {pile.fbsCount > 0 ? ` · ${pile.fbsCount} FBS` : ''}
        </span>
        {featured && (
          <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-orange-700">
            Бери этой швеи первой
          </span>
        )}
      </span>
      <Icon
        name="ChevronDown"
        size={18}
        className={`mt-1.5 shrink-0 text-orange-400 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>

    {open && (
      <div className="border-t border-orange-100 px-3 pb-2 pt-1.5">
        <ul className="space-y-1">
          {pile.items.map((o) => (
            <li key={o.id} className="min-w-0 text-sm leading-snug">
              <p className="truncate font-mono-tech text-xs font-bold text-orange-950">
                {o.orderNumber}
              </p>
              <p className="truncate text-sm text-orange-900">
                {productLabel(o) || '—'}
                {o.orderType === 'FBS' ? ' · FBS' : ''}
              </p>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onOpenConveyor}
          className="mt-2 w-full rounded-md bg-orange-500 px-3 py-2 text-sm font-bold text-white active:bg-orange-600"
        >
          Открыть на стикеровке
        </button>
      </div>
    )}
  </div>
);

export default PackerStickerQueueCard;
