import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { fetchRollAudit, fetchRollAudits, type RollAudit, type RollAuditDetail } from '@/lib/rollAuditsApi';

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
const qty = (n: number | null) => (n == null ? '' : (Math.round(n * 100) / 100).toLocaleString('ru-RU'));

const AuditDetailDialog = ({ id, onClose }: { id: number | null; onClose: () => void }) => {
  const [d, setD] = useState<RollAuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    setError(null);
    if (id) fetchRollAudit(id).then(setD).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'));
  }, [id]);

  const extras = d?.scans.filter((s) => s.result !== 'ok') || [];

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Сверка №{id}</DialogTitle>
        </DialogHeader>
        {error && <div className="text-sm text-destructive">{error}</div>}
        {!d && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        )}
        {d && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {d.audit.status === 'in_progress' ? 'Идёт сейчас' : `Завершена ${dt(d.audit.finishedAt)}`} · начал{' '}
              {d.audit.startedByName || '—'} {dt(d.audit.startedAt)}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-2">
                <div className="text-xl font-bold text-emerald-600">{d.audit.found}</div>
                <div className="text-xs text-muted-foreground">найдено из {d.audit.expected}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-xl font-bold text-red-600">{d.audit.missing}</div>
                <div className="text-xs text-muted-foreground">не найдено</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-xl font-bold text-amber-600">{d.audit.extra}</div>
                <div className="text-xs text-muted-foreground">лишние</div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-semibold text-red-700">Не найдено на складе · {d.missing.length}</div>
              <div className="divide-y divide-border rounded-md border">
                {d.missing.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">Всё найдено</div>}
                {d.missing.map((m) => (
                  <Link
                    key={m.barcode}
                    to={`/crm/inventory/rolls/${m.rollId}`}
                    className="flex justify-between gap-2 px-3 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <span>
                      <span className="font-mono font-semibold">{m.barcode}</span>
                      <span className="ml-2 text-muted-foreground">{m.material}</span>
                    </span>
                    <span className="tabular-nums">
                      {qty(m.remaining)} {m.unit}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            {extras.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-semibold text-amber-700">
                  Нашлись, но по учёту не на складе · {extras.length}
                </div>
                <div className="divide-y divide-border rounded-md border">
                  {extras.map((s) => (
                    <div key={s.barcode} className="flex justify-between gap-2 px-3 py-1.5 text-sm">
                      <span>
                        <span className="font-mono font-semibold">{s.barcode}</span>
                        <span className="ml-2 text-muted-foreground">{s.material || 'нет в системе'}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {s.result === 'unknown' ? 'стикера нет в системе' : `по учёту ${s.rollStatus}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Выпадающий список пройденных сверок склада материалов. */
const RollAuditHistory = ({ refreshKey }: { refreshKey: number }) => {
  const [audits, setAudits] = useState<RollAudit[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    fetchRollAudits()
      .then(setAudits)
      .catch(() => setAudits([]));
  }, [refreshKey]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Icon name="History" size={16} className="mr-1.5" />
            Сверки{audits && audits.length ? ` · ${audits.length}` : ''}
            <Icon name="ChevronDown" size={14} className="ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-96 w-80 overflow-y-auto">
          <DropdownMenuLabel>Пройденные сверки</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!audits && <div className="px-2 py-2 text-sm text-muted-foreground">Загрузка...</div>}
          {audits && audits.length === 0 && (
            <div className="px-2 py-2 text-sm text-muted-foreground">Сверок ещё не было</div>
          )}
          {audits?.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => setOpenId(a.id)} className="flex-col items-start gap-0.5">
              <div className="flex w-full justify-between gap-2">
                <span className="font-medium">№{a.id}</span>
                <span className="text-xs text-muted-foreground">
                  {a.status === 'in_progress' ? 'идёт сейчас' : dt(a.finishedAt)}
                </span>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-700">найдено {a.found}/{a.expected}</span>
                <span className={cn(a.missing > 0 ? 'font-semibold text-red-700' : 'text-muted-foreground')}>
                  нет {a.missing}
                </span>
                {a.extra > 0 && <span className="text-amber-700">лишних {a.extra}</span>}
              </div>
              <div className="text-xs text-muted-foreground">{a.finishedByName || a.startedByName}</div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <AuditDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
};

export default RollAuditHistory;
