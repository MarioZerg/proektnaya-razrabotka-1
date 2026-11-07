import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  buildSewPlan,
  createSewSupply,
  fetchSewState,
  syncSewData,
  type SewPlan,
  type SewState,
} from '@/lib/fboSewPlanApi';
import SewLinesList from './SewLinesList';
import SewSummary from './SewSummary';
import SewTransitSupplies from './SewTransitSupplies';

const AUTO = '__auto__';
const MIN = 10;
const MAX = 1000;

interface FboSewPlanPanelProps {
  shopId: number | null;
  isAdmin: boolean;
  onOpenSupply: (id: number) => void;
}

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Автопредложка поставки FBO в пошив: бегунок штук → кластер и состав по ходовым размерам. */
const FboSewPlanPanel = ({ shopId, isAdmin, onOpenSupply }: FboSewPlanPanelProps) => {
  const { toast } = useToast();
  const [pieces, setPieces] = useState(300);
  const [cluster, setCluster] = useState<string>(AUTO);
  const [removed, setRemoved] = useState<number[]>([]);
  const [added, setAdded] = useState<number[]>([]);
  const [plan, setPlan] = useState<SewPlan | null>(null);
  const [state, setState] = useState<SewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showWeak, setShowWeak] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const reqKey = useRef(newKey());
  const seq = useRef(0);

  const loadState = useCallback(async () => {
    if (!shopId || !isAdmin) return;
    try {
      setState(await fetchSewState(shopId));
    } catch {
      /* не мешаем расчёту */
    }
  }, [shopId, isAdmin]);

  const build = useCallback(async () => {
    if (!shopId || !isAdmin) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await buildSewPlan(shopId, {
        pieces,
        cluster: cluster === AUTO ? null : cluster,
        removed,
        added,
      });
      if (my !== seq.current) return;
      setPlan(res);
      setError(null);
      reqKey.current = newKey();
    } catch (e) {
      if (my !== seq.current) return;
      setPlan(null);
      setError(e instanceof Error ? e.message : 'Не удалось рассчитать');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [shopId, isAdmin, pieces, cluster, removed, added]);

  useEffect(() => {
    setPlan(null);
    setRemoved([]);
    setAdded([]);
    setCluster(AUTO);
    loadState();
  }, [shopId, loadState]);

  useEffect(() => {
    const t = window.setTimeout(build, 450);
    return () => window.clearTimeout(t);
  }, [build]);

  const sync = async () => {
    if (!shopId) return;
    setSyncing(true);
    try {
      let stockDone = false;
      for (let i = 0; i < 4 && !stockDone; i += 1) {
        const r = await syncSewData(shopId);
        stockDone = Boolean(r.stock?.done);
      }
      toast({ title: stockDone ? 'Данные Ozon обновлены' : 'Часть данных Ozon не успела загрузиться — нажмите ещё раз' });
      await loadState();
      await build();
    } catch (e) {
      toast({
        title: 'Не удалось обновить данные Ozon',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const create = async () => {
    if (!shopId || !plan) return;
    setCreating(true);
    try {
      const res = await createSewSupply(
        shopId,
        { pieces, cluster: plan.cluster, removed, added },
        reqKey.current,
      );
      toast({
        title: res.repeat ? 'Поставка уже была создана' : `Поставка №${res.supplyId} создана`,
        description: res.repeat
          ? undefined
          : `${res.pieces} шт.: в пошив ${res.toSew}, со склада ${res.fromStock}` +
            (res.intercepted ? `, крой отменённых заказов ${res.intercepted}` : ''),
      });
      reqKey.current = newKey();
      setRemoved([]);
      setAdded([]);
      onOpenSupply(res.supplyId);
    } catch (e) {
      toast({
        title: 'Поставка не создана',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      build();
    } finally {
      setCreating(false);
    }
  };

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">Поставки в пошив формирует администратор.</p>;
  }

  const busy = loading || creating || syncing;
  const fbo = state?.freshness?.FBO?.syncedTo;
  const stockAt = state?.freshness?.STOCK?.syncedTo;
  const clusters = plan?.clusters ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Система смотрит, в какие регионы покупают по Ozon, чего не хватает на складах этих регионов, и
          предлагает, что сшить. Берёт только продаваемые товары и ходовые размеры, учитывает ткань на
          складе и в цехе. Готовое с полок и крой отменённых заказов идут в поставку в первую очередь.
        </p>
        <div className="flex flex-col items-end gap-1">
          <Button type="button" variant="outline" onClick={sync} disabled={busy}>
            <Icon name={syncing ? 'Loader2' : 'RefreshCw'} size={16} className={`mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Обновить данные Ozon
          </Button>
          <span className="text-xs text-muted-foreground">
            Заказы: {fbo ? new Date(fbo).toLocaleString('ru-RU') : 'нет'} · остатки:{' '}
            {stockAt ? new Date(stockAt).toLocaleString('ru-RU') : 'нет'}
          </span>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border-2 border-teal-600 bg-card p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Сколько штук отдать в пошив</span>
              <Input
                type="number"
                min={MIN}
                max={MAX}
                value={pieces}
                onChange={(e) => setPieces(Math.max(MIN, Math.min(MAX, Number(e.target.value) || MIN)))}
                className="h-8 w-24 text-right"
              />
            </div>
            <Slider
              className="mt-3"
              min={MIN}
              max={MAX}
              step={10}
              value={[pieces]}
              onValueChange={(v) => setPieces(v[0])}
            />
          </div>
          <div>
            <span className="text-sm font-medium">Регион Ozon</span>
            <Select
              value={cluster}
              onValueChange={(v) => {
                setCluster(v);
                setRemoved([]);
                setAdded([]);
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Выбрать автоматически</SelectItem>
                {clusters
                  .filter((c) => !c.home)
                  .map((c) => (
                    <SelectItem key={c.cluster} value={c.cluster}>
                      {c.cluster} · нужно {c.need}
                      {c.inWork > 0 ? ` · в пути ${c.inWork}` : ''} · лок. {c.localPercent ?? 0}%
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading && !plan && <p className="text-sm text-muted-foreground">Считаю предложку…</p>}

        {plan && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold">
                  {plan.cluster}
                  {cluster === AUTO && <span className="ml-2 text-sm font-normal text-muted-foreground">выбран автоматически</span>}
                </h2>
                <p className="text-sm">
                  {plan.pieces} шт., {plan.lines.length} позиций
                  {loading && <Icon name="Loader2" size={14} className="ml-2 inline animate-spin" />}
                </p>
                {plan.note && <p className="text-sm text-amber-700">{plan.note}</p>}
              </div>
              <Button type="button" onClick={create} disabled={busy || !plan.lines.length}>
                <Icon name={creating ? 'Loader2' : 'Scissors'} size={16} className={`mr-2 ${creating ? 'animate-spin' : ''}`} />
                Создать поставку в пошив
              </Button>
            </div>

            <SewSummary cluster={plan.cluster} localization={plan.localization} fabric={plan.fabric} />

            <SewTransitSupplies
              cluster={plan.cluster}
              supplies={plan.transit ?? []}
              onOpenSupply={onOpenSupply}
            />

            <SewLinesList
              lines={plan.lines}
              mode="plan"
              busy={busy}
              onRemove={(sku) => {
                setRemoved((r) => [...r, sku]);
                setAdded((a) => a.filter((x) => x !== sku));
              }}
            />

            {plan.weak.length > 0 && (
              <div className="space-y-2">
                <button type="button" className="text-sm font-medium underline" onClick={() => setShowWeak((v) => !v)}>
                  Плохо продаются — не берём ({plan.weak.length})
                </button>
                {showWeak && (
                  <SewLinesList
                    lines={plan.weak}
                    mode="weak"
                    busy={busy}
                    onAdd={(sku) => setAdded((a) => [...a, sku])}
                  />
                )}
              </div>
            )}

            {plan.skipped.length > 0 && (
              <div className="space-y-2">
                <button type="button" className="text-sm font-medium underline" onClick={() => setShowSkipped((v) => !v)}>
                  Не попали в поставку ({plan.skipped.length})
                </button>
                {showSkipped && (
                  <SewLinesList
                    lines={plan.skipped}
                    mode="skipped"
                    busy={busy}
                    onAdd={(sku) => setRemoved((r) => r.filter((x) => x !== sku))}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {state && state.history.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Последние поставки в пошив</p>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {state.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  №{h.supplyId} · {h.cluster} · {h.pieces} шт. (в пошив {h.toSew}, со склада {h.fromStock})
                  {h.locNow != null && ` · локализация ${h.locNow}% → ${h.locAfter}%`}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {new Date(h.createdAt).toLocaleString('ru-RU')} {h.createdBy || ''} · {h.supplyStatus || ''}
                  <Button type="button" size="sm" variant="ghost" onClick={() => onOpenSupply(h.supplyId)}>
                    Открыть
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FboSewPlanPanel;
