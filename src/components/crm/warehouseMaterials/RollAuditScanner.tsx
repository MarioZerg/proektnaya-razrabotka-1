import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import {
  cancelRollAudit,
  finishRollAudit,
  saveRollAuditScans,
  startRollAudit,
  type RollAudit,
  type RollAuditMissing,
} from '@/lib/rollAuditsApi';

interface RollAuditScannerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFinished: () => void;
}

/** Сканы копятся и уходят на сервер пачкой раз в несколько секунд — не по запросу на каждый стикер. */
const FLUSH_MS = 3000;

const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ru-RU');

type Flash = { text: string; ok: boolean } | null;

/**
 * Сверка склада материалов. Список «что числится на складе» приходит один раз при
 * старте, каждый скан проверяется прямо в браузере мгновенно. Принимаются только
 * стикеры рулонов, которые числятся на складе, — всё остальное отклоняется и никуда
 * не записывается. Сверка ничего не меняет в рулонах.
 */
const RollAuditScanner = ({ open, onOpenChange, onFinished }: RollAuditScannerProps) => {
  const [audit, setAudit] = useState<RollAudit | null>(null);
  const [expected, setExpected] = useState<Map<string, RollAuditMissing>>(new Map());
  const [found, setFound] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [filter, setFilter] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Set<string>>(new Set());
  const auditId = audit?.id;

  const flush = useCallback(async () => {
    if (!auditId || pending.current.size === 0) return true;
    const batch = [...pending.current];
    try {
      await saveRollAuditScans(auditId, batch);
      batch.forEach((b) => pending.current.delete(b));
      setPendingCount(pending.current.size);
      return true;
    } catch {
      return false;
    }
  }, [auditId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFlash(null);
    setConfirmFinish(false);
    setAudit(null);
    startRollAudit()
      .then((s) => {
        setAudit(s.audit);
        setExpected(new Map(s.expected.map((e) => [e.barcode.toUpperCase(), e])));
        setFound(s.found.map((b) => b.toUpperCase()));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'));
  }, [open]);

  useEffect(() => {
    if (!open || !auditId) return;
    const t = setInterval(flush, FLUSH_MS);
    return () => clearInterval(t);
  }, [open, auditId, flush]);

  // Фокус всегда в строке сканера: после открытия окна (оно появляется с анимацией,
  // поэтому с задержкой), после каждого скана и если кладовщик ткнул мимо поля.
  // Поиск в правой колонке фокус не забирает, пока им пользуются.
  const focusScan = useCallback(() => {
    setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== inputRef.current && el.dataset.keepFocus === '1') return;
      inputRef.current?.focus();
    }, 50);
  }, []);

  useEffect(() => {
    if (!open || !audit) return;
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [open, audit]);

  useEffect(() => {
    if (open && audit) focusScan();
  }, [open, audit, flash, focusScan]);

  const foundSet = useMemo(() => new Set(found), [found]);

  const scan = () => {
    const v = code.trim().toUpperCase();
    setCode('');
    focusScan();
    if (!v) return;
    const roll = expected.get(v);
    if (!roll) {
      setFlash({ text: `${v} — не числится на складе, не засчитан`, ok: false });
      return;
    }
    if (foundSet.has(v)) {
      setFlash({ text: `${v} уже отсканирован`, ok: true });
      return;
    }
    setFound((f) => [v, ...f]);
    pending.current.add(v);
    setPendingCount(pending.current.size);
    setFlash({ text: `${v} · ${roll.material} — найден`, ok: true });
  };

  const close = async (v: boolean) => {
    if (!v) await flush();
    onOpenChange(v);
  };

  const finish = async () => {
    if (!auditId) return;
    setBusy(true);
    try {
      if (!(await flush())) throw new Error('Не удалось сохранить последние сканы, проверьте связь');
      await finishRollAudit(auditId);
      onFinished();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!auditId) return;
    setBusy(true);
    try {
      pending.current.clear();
      await cancelRollAudit(auditId);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  // Сканер не всегда присылает Enter — отправляем сами, когда пачка символов закончилась.
  useScannerAutoSubmit(code, scan, open && !!audit);

  const missing = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = [...expected.values()].filter((e) => !foundSet.has(e.barcode.toUpperCase()));
    return f ? list.filter((m) => m.barcode.toLowerCase().includes(f) || m.material.toLowerCase().includes(f)) : list;
  }, [expected, foundSet, filter]);

  const missingTotal = expected.size - found.length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex max-h-[95vh] max-w-5xl flex-col gap-3 overflow-hidden p-4 sm:p-6"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Сверка склада материалов{audit ? ` №${audit.id}` : ''}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Сканируйте стикеры склада. Засчитываются только рулоны и пачки, которые числятся на складе. Сверка ничего не
            удаляет и не меняет.
          </p>
        </DialogHeader>

        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        {!audit ? (
          !error && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Готовлю сверку...
            </div>
          )
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                scan();
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Отсканируйте стикер склада"
                className="h-12 font-mono text-lg"
                autoFocus
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    scan();
                  }
                }}
                onBlur={focusScan}
              />
              <Button type="submit" className="h-12" disabled={!code.trim()}>
                <Icon name="ScanLine" size={18} />
              </Button>
            </form>

            {flash && (
              <div
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-semibold text-white',
                  flash.ok ? 'bg-emerald-600' : 'bg-red-600',
                )}
              >
                {flash.text}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-center text-sm">
              <div className="rounded-md border border-border p-2">
                <div className="text-2xl font-bold text-emerald-600">{found.length}</div>
                <div className="text-xs text-muted-foreground">найдено из {expected.size}</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-2xl font-bold text-red-600">{missingTotal}</div>
                <div className="text-xs text-muted-foreground">ещё не найдено</div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex min-h-0 flex-col rounded-md border border-border">
                <div className="flex justify-between border-b border-border bg-muted/50 px-3 py-2 text-sm font-semibold">
                  <span>Отсканировано · {found.length}</span>
                  {pendingCount > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">сохраняю {pendingCount}...</span>
                  )}
                </div>
                <div className="min-h-[160px] flex-1 divide-y divide-border overflow-y-auto">
                  {found.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">Пока ничего не отсканировано</div>
                  )}
                  {found.map((b) => {
                    const r = expected.get(b);
                    return (
                      <div key={b} className="flex justify-between gap-2 border-l-4 border-emerald-400 px-3 py-1.5 text-sm">
                        <div className="min-w-0">
                          <div className="font-mono font-semibold">{b}</div>
                          <div className="truncate text-xs text-muted-foreground">{r?.material}</div>
                        </div>
                        {r && (
                          <div className="shrink-0 text-xs tabular-nums">
                            {qty(r.remaining)} {r.unit}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-md border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
                  <span className="text-sm font-semibold">Ещё должно быть · {missingTotal}</span>
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Поиск"
                    className="h-7 w-32 text-xs"
                    data-keep-focus="1"
                    onBlur={focusScan}
                  />
                </div>
                <div className="min-h-[160px] flex-1 divide-y divide-border overflow-y-auto">
                  {missing.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-emerald-700">
                      {missingTotal === 0 ? 'Всё, что числится, найдено' : 'Ничего не подошло'}
                    </div>
                  )}
                  {missing.map((m) => (
                    <Link
                      key={m.barcode}
                      to={`/crm/inventory/rolls/${m.rollId}`}
                      target="_blank"
                      className="flex justify-between gap-2 px-3 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-semibold">{m.barcode}</div>
                        <div className="truncate text-xs text-muted-foreground">{m.material}</div>
                      </div>
                      <div className="shrink-0 text-right text-xs tabular-nums">
                        {qty(m.remaining)} {m.unit}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                Отменить сверку
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Можно закрыть окно и продолжить позже</span>
                {confirmFinish ? (
                  <>
                    <Button variant="outline" onClick={() => setConfirmFinish(false)} disabled={busy}>
                      Продолжить сканировать
                    </Button>
                    <Button onClick={finish} disabled={busy}>
                      Да, завершить ({missingTotal} не найдено)
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setConfirmFinish(true)} disabled={busy}>
                    <Icon name="CheckCircle2" size={16} className="mr-1.5" />
                    Завершить сверку
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RollAuditScanner;
