import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import LiveFloorHeader from '@/components/crm/dashboard/liveFloor/LiveFloorHeader';
import LiveFloorSummary from '@/components/crm/dashboard/liveFloor/LiveFloorSummary';
import LiveFloorExpanded from '@/components/crm/dashboard/liveFloor/LiveFloorExpanded';
import { buildLiveFloorView, useLiveFloorData } from '@/components/crm/dashboard/liveFloor/useLiveFloorData';

const OPEN_KEY = 'megatul_live_floor_open';

/**
 * ЖИВОЙ ЦЕХ — экран администратора: как вещи под своими номерами едут по цепочке
 * раскрой → оверлок → пошив → стикеровка → готово, и что каждый человек на смене
 * делает прямо сейчас.
 */
const LiveFloorCard = () => {
  const [workshop, setWorkshop] = useState<number | 'all'>('all');
  const [big, setBig] = useState(false);
  // Свёрнут по умолчанию: на телефоне раскрытый блок занимает несколько экранов.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const expanded = open || big;

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(OPEN_KEY, next ? '1' : '0');
      } catch {
        /* приватный режим браузера — просто не запоминаем */
      }
      return next;
    });
  };
  const [query, setQuery] = useState('');

  const {
    data,
    error,
    comets,
    movedIds,
    freshKeys,
    clockOffset,
    updatedAt,
    feedOpen,
    toggleFeed,
    load,
    removeComet,
  } = useLiveFloorData(expanded);

  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBig(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [big]);

  const view = useMemo(() => buildLiveFloorView(data, workshop, clockOffset), [data, workshop, clockOffset]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (view && q.length >= 3 ? view.orders.filter((o) => o.orderNumber.toLowerCase().includes(q)) : []),
    [view, q],
  );
  const highlightIds = useMemo(() => new Set(matches.map((o) => o.id)), [matches]);

  const body = (
    <Card className={`overflow-visible border-border shadow-none ${big ? 'min-h-full rounded-none border-0' : ''}`}>
      <CardContent className={`px-3 sm:px-6 ${expanded ? 'space-y-5 pt-6' : 'space-y-3 py-4'}`}>
        <LiveFloorHeader big={big} expanded={expanded} updatedAt={updatedAt} onToggle={toggleOpen} />

        {!expanded && (
          <LiveFloorSummary data={data} view={view} error={error} onRetry={load} onToggle={toggleOpen} />
        )}

        {expanded && (
          <LiveFloorExpanded
            data={data}
            view={view}
            error={error}
            onRetry={load}
            big={big}
            onToggleBig={() => setBig((v) => !v)}
            workshop={workshop}
            onWorkshopChange={setWorkshop}
            query={query}
            onQueryChange={setQuery}
            q={q}
            matches={matches}
            highlightIds={highlightIds}
            comets={comets}
            onCometDone={removeComet}
            movedIds={movedIds}
            freshKeys={freshKeys}
            clockOffset={clockOffset}
            feedOpen={feedOpen}
            onToggleFeed={toggleFeed}
          />
        )}
      </CardContent>
    </Card>
  );

  return big ? <div className="fixed inset-0 z-40 overflow-y-auto bg-background">{body}</div> : body;
};

export default LiveFloorCard;
