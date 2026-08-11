import { useCallback, useState } from 'react';
import { fetchOnlineNow, type OnlineNow } from '@/lib/authApi';
import { usePolling } from '@/hooks/usePolling';

/** Сколько человек сейчас на смене во всех цехах. Показывается на экране входа.
 * Имён не показываем — экран виден кому угодно.
 *
 * Экран входа часто остаётся открытым на планшете весь день. Обновляем раз в 5 минут
 * и только когда на него смотрят: точнее эта справочная цифра быть не обязана. */
const OnlineNowBadge = () => {
  const [data, setData] = useState<OnlineNow | null>(null);

  const load = useCallback(
    () => fetchOnlineNow().then(setData).catch(() => setData(null)),
    [],
  );

  usePolling(load, 300000);

  if (!data) return null;

  const word =
    data.total % 10 === 1 && data.total % 100 !== 11
      ? 'человек работает'
      : 'человек работают';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2 rounded-full border border-border px-3 py-1">
        <span className="relative flex h-2 w-2">
          {data.total > 0 && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              data.total > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            }`}
          />
        </span>
        <span className="text-xs text-muted-foreground">
          {data.total > 0 ? (
            <>
              Online: <b className="text-foreground">{data.total}</b> {word}
            </>
          ) : (
            'Сейчас никто не работает'
          )}
        </span>
      </div>

      {data.byWorkshop.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {data.byWorkshop.map((w) => `${w.workshop} — ${w.count}`).join(' · ')}
        </p>
      )}
    </div>
  );
};

export default OnlineNowBadge;