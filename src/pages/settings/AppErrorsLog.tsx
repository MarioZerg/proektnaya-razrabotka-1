import { useCallback, useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import LogsTabs from '@/components/crm/logs/LogsTabs';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import {
  fetchAppErrors,
  fetchAppErrorSummary,
  type AppErrorItem,
  type AppErrorSummaryRow,
} from '@/lib/appErrorsApi';

const roleLabels: Record<string, string> = {
  admin: 'Админ',
  sewer: 'Швея',
  cutter: 'Раскройщик',
  packer: 'Упаковщик',
  packer_returns: 'Упаковщик возвратов',
  storekeeper: 'Кладовщик',
  senior_storekeeper: 'Ст. кладовщик',
  cleaner: 'Уборщица',
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

const device = (ua: string | null) => {
  if (!ua) return null;
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
};

/** Сбои программы у сотрудников: что упало, где, у кого и когда. */
const AppErrorsLog = () => {
  const [items, setItems] = useState<AppErrorItem[]>([]);
  const [summary, setSummary] = useState<AppErrorSummaryRow[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, top] = await Promise.all([fetchAppErrors(query, limit), fetchAppErrorSummary()]);
      setItems(list);
      setSummary(top);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить сбои');
    } finally {
      setLoading(false);
    }
  }, [query, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const total7 = summary.reduce((s, r) => s + r.count, 0);

  return (
    <CrmLayout>
      <div className="space-y-4 sm:space-y-6">
        <div className="space-y-3">
          <LogsTabs />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Icon name="Bug" size={22} className="shrink-0" />
              Сбои у сотрудников
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ошибки программы, которые появлялись у сотрудников во время работы: что сломалось, на какой странице и у кого.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Сбоев за 7 дней</div>
            <div className="mt-1 text-2xl font-bold">{total7}</div>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">Разных ошибок</div>
            <div className="mt-1 text-2xl font-bold">{summary.length}</div>
          </div>
          <div className="col-span-2 rounded-xl border bg-card p-4 sm:col-span-1">
            <div className="text-xs text-muted-foreground">Последний сбой</div>
            <div className="mt-1 text-lg font-semibold">{fmt(items[0]?.at ?? null)}</div>
          </div>
        </div>

        {summary.length > 0 && (
          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3 text-sm font-semibold">Чаще всего за 7 дней</div>
            <div className="divide-y">
              {summary.slice(0, 8).map((r) => (
                <button
                  key={r.message}
                  type="button"
                  onClick={() => {
                    setSearch(r.message.slice(0, 80));
                    setQuery(r.message.slice(0, 80));
                  }}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/50"
                >
                  <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
                    ×{r.count}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{r.message}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {r.users} чел. · {fmt(r.lastAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search);
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по тексту ошибки"
            className="min-w-[200px] flex-1"
          />
          <Button type="submit" variant="secondary">
            <Icon name="Search" size={16} />
            Найти
          </Button>
          {query && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearch('');
                setQuery('');
              }}
            >
              Сбросить
            </Button>
          )}
          <Button type="button" variant="outline" onClick={load} disabled={loading}>
            <Icon name="RefreshCw" size={16} className={loading ? 'animate-spin' : ''} />
            Обновить
          </Button>
        </form>

        {error && <WarehouseFetchError title="Не удалось загрузить сбои" description={error} onRetry={load} />}

        {!error && (
          <div className="overflow-hidden rounded-xl border bg-card">
            {loading && items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Загружаю…</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {query ? 'По такому тексту сбоев нет' : 'Сбоев нет — программа работает без ошибок'}
              </div>
            ) : (
              <div className="divide-y">
                {items.map((it) => {
                  const open = openId === it.id;
                  const dev = device(it.userAgent);
                  return (
                    <div key={it.id} className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : it.id)}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <Icon
                          name={it.level === 'warn' ? 'TriangleAlert' : 'CircleAlert'}
                          size={18}
                          className={`mt-0.5 shrink-0 ${it.level === 'warn' ? 'text-amber-500' : 'text-destructive'}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="break-words text-sm font-medium">{it.message}</div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{fmt(it.at)}</span>
                            <span>
                              {it.userName || 'Не вошёл в систему'}
                              {it.userRole ? ` · ${roleLabels[it.userRole] || it.userRole}` : ''}
                            </span>
                            {it.page && <span className="font-mono">{it.page}</span>}
                            {dev && <span>{dev}</span>}
                          </div>
                        </div>
                        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} className="mt-1 shrink-0 text-muted-foreground" />
                      </button>
                      {open && (
                        <div className="mt-3 space-y-2 pl-7 text-xs">
                          {it.stack && (
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono">
                              {it.stack}
                            </pre>
                          )}
                          {it.userAgent && <div className="break-words text-muted-foreground">Браузер: {it.userAgent}</div>}
                          {it.appVersion && <div className="text-muted-foreground">Версия: {it.appVersion}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!error && items.length >= limit && limit < 200 && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setLimit(200)} disabled={loading}>
              Показать больше
            </Button>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default AppErrorsLog;
