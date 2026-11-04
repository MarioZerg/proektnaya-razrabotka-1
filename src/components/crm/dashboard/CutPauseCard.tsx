import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchCutPause, setCutPause, type CutPauseState } from '@/lib/ordersApi';

/**
 * Пауза выдачи тканей на раскрой: кончилась ткань — админ выключает её тумблером,
 * и закройщики получают в стек заказы из других тканей. Привезли — включает обратно.
 */
const CutPauseCard = () => {
  const { toast } = useToast();
  const [state, setState] = useState<CutPauseState>({ paused: [], materials: [] });
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchCutPause().then(setState).catch(() => undefined);
  }, []);

  const toggle = async (name: string, issueOn: boolean) => {
    const prev = state.paused;
    const next = issueOn ? prev.filter((n) => n !== name) : [...prev, name];
    setState((s) => ({ ...s, paused: next }));
    setSaving(name);
    try {
      await setCutPause(next);
      toast({
        title: issueOn
          ? `${name} снова выдаётся закройщикам`
          : `${name} не выдаётся закройщикам`,
      });
    } catch (e) {
      setState((s) => ({ ...s, paused: prev }));
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(null);
    }
  };

  if (!state.materials.length) return null;

  const pausedCount = state.paused.length;

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        pausedCount ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon name="Scissors" size={18} />
        Выдача тканей на раскрой
        {pausedCount > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
            выключено: {pausedCount}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Ткань закончилась — выключите её, закройщики будут получать заказы из других тканей.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {state.materials.map((m) => {
          const on = !state.paused.includes(m.name);
          return (
            <label
              key={m.name}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
                on
                  ? 'border-border bg-background text-foreground'
                  : 'border-amber-400 bg-amber-100 text-amber-950'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{m.name}</div>
                <div className="text-xs opacity-70">
                  {on ? 'Выдаётся' : 'Не выдаётся'} · в очереди {m.count}
                </div>
              </div>
              <Switch
                checked={on}
                disabled={saving !== null}
                onCheckedChange={(v) => toggle(m.name, v)}
                aria-label={`Выдача ткани ${m.name}`}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default CutPauseCard;
