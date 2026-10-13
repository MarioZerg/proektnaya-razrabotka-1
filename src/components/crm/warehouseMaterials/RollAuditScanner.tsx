import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import {
  cancelRollAudit,
  finishRollAudit,
  scanRollAudit,
  startRollAudit,
  type RollAuditDetail,
  type RollAuditScan,
} from '@/lib/rollAuditsApi';

interface RollAuditScannerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onFinished: () => void;
}

const qty = (n: number | null) => (n == null ? '' : (Math.round(n * 100) / 100).toLocaleString('ru-RU'));

const SCAN_STYLE: Record<RollAuditScan['result'], { label: string; className: string }> = {
  ok: { label: 'Числится', className: 'border-emerald-300 bg-emerald-50' },
  extra: { label: 'Не на складе по учёту', className: 'border-amber-300 bg-amber-50' },
  unknown: { label: 'Нет в системе', className: 'border-red-300 bg-red-50' },
};

const lastText = (l: NonNullable<RollAuditDetail['last']>) => {
  if (l.duplicate) return { text: `${l.barcode} уже отсканирован`, className: 'bg-muted text-foreground' };
  if (l.result === 'ok') return { text: `${l.barcode} · ${l.material} — найден`, className: 'bg-emerald-600 text-white' };
  if (l.result === 'extra')
    return { text: `${l.barcode} · ${l.material} — по учёту ${l.rollStatus}`, className: 'bg-amber-500 text-white' };
  return { text: `${l.barcode} — такого стикера нет в системе`, className: 'bg-red-600 text-white' };
};

/**
 * Сверка склада материалов. Слева — что отсканировано, справа — что ещё должно
 * найтись. Ничего не меняет в рулонах, только собирает информацию.
 */
const RollAuditScanner = ({ open, onOpenChange, onFinished }: RollAuditScannerProps) => {
  const [data, setData] = useState<RollAuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmFinish(false);
    startRollAudit()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'));
  }, [open]);

  useEffect(() => {
    if (open && data && !busy) inputRef.current?.focus();
  }, [open, data, busy]);

  const scan = async () => {
    const v = code.trim();
    if (!v || !data) return;
    setCode('');
    setBusy(true);
    try {
      setData(await scanRollAudit(data.audit.id, v));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await finishRollAudit(data.audit.id);
      onFinished();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await cancelRollAudit(data.audit.id);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const missing = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = data?.missing || [];
    return f ? list.filter((m) => m.barcode.toLowerCase().includes(f) || m.material.toLowerCase().includes(f)) : list;
  }, [data, filter]);

  const a = data?.audit;
  const last = data?.last ? lastText(data.last) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] max-w-5xl flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Сверка склада материалов{a ? ` №${a.id}` : ''}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Пройдите по складу и отсканируйте стикер каждого рулона и пачки. Сверка ничего не удаляет и не меняет —
            только показывает, чего не хватает.
          </p>
        </DialogHeader>

        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        {!data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Готовлю сверку...
          </div>
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
                placeholder="Отсканируйте стикер рулона"
                className="h-12 font-mono text-lg"
                autoFocus
              />
              <Button type="submit" className="h-12" disabled={busy || !code.trim()}>
                <Icon name="ScanLine" size={18} />
              </Button>
            </form>

            {last && <div className={cn('rounded-md px-3 py-2 text-sm font-semibold', last.className)}>{last.text}</div>}

            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-md border border-border p-2">
                <div className="text-2xl font-bold text-emerald-600">{a!.found}</div>
                <div className="text-xs text-muted-foreground">найдено из {a!.expected}</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-2xl font-bold text-red-600">{a!.missing}</div>
                <div className="text-xs text-muted-foreground">ещё не найдено</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-2xl font-bold text-amber-600">{a!.extra}</div>
                <div className="text-xs text-muted-foreground">лишние / не по учёту</div>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex min-h-0 flex-col rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-3 py-2 text-sm font-semibold">
                  Отсканировано · {data.scans.length}
                </div>
                <div className="min-h-[160px] flex-1 divide-y divide-border overflow-y-auto">
                  {data.scans.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">Пока ничего не отсканировано</div>
                  )}
                  {data.scans.map((s) => (
                    <div key={s.barcode} className={cn('border-l-4 px-3 py-1.5 text-sm', SCAN_STYLE[s.result].className)}>
                      <div className="flex justify-between gap-2">
                        <span className="font-mono font-semibold">{s.barcode}</span>
                        <span className="text-xs">{SCAN_STYLE[s.result].label}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.material || '—'}
                        {s.remaining != null ? ` · ${qty(s.remaining)}` : ''}
                        {s.result === 'extra' && s.rollStatus ? ` · по учёту ${s.rollStatus}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex min-h-0 flex-col rounded-md border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5">
                  <span className="text-sm font-semibold">Ещё должно быть · {data.missing.length}</span>
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Поиск"
                    className="h-7 w-32 text-xs"
                  />
                </div>
                <div className="min-h-[160px] flex-1 divide-y divide-border overflow-y-auto">
                  {missing.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-emerald-700">
                      {data.missing.length === 0 ? 'Всё, что числится, найдено' : 'Ничего не подошло'}
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
                      Да, завершить ({a!.missing} не найдено)
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
