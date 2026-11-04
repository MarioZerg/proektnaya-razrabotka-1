import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SewLine } from '@/lib/fboSewPlanApi';

const gradeLabel: Record<string, { text: string; cls: string }> = {
  hot: { text: 'ходовой', cls: 'bg-emerald-100 text-emerald-800' },
  normal: { text: 'продаётся', cls: 'bg-sky-100 text-sky-800' },
  weak: { text: 'плохо продаётся', cls: 'bg-amber-100 text-amber-900' },
};

interface SewLinesListProps {
  lines: SewLine[];
  mode: 'plan' | 'weak' | 'skipped';
  busy: boolean;
  onRemove?: (sku: number) => void;
  onAdd?: (sku: number) => void;
}

/** Строки предложки: в плане (можно убрать), плохо продаваемые (можно добавить), пропущенные. */
const SewLinesList = ({ lines, mode, busy, onRemove, onAdd }: SewLinesListProps) => {
  if (!lines.length) return null;
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {lines.map((l) => {
        const g = l.grade ? gradeLabel[l.grade] : null;
        return (
          <li key={l.sku} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {l.material && l.width && l.height ? `${l.material} ${l.width}x${l.height}` : l.name}
                </span>
                {g && <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${g.cls}`}>{g.text}</span>}
                {!l.popularSize && mode === 'plan' && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    редкий размер
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                Продано в регион {l.sold} · всего {l.soldTotal} · есть на Ozon {l.onOzon} · нужно {l.need}
                {l.note ? ` · ${l.note}` : ''}
              </div>
            </div>
            {mode === 'plan' && (
              <span className="shrink-0 tabular-nums text-base font-semibold">{l.quantity} шт.</span>
            )}
            {mode === 'plan' && onRemove && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onRemove(l.sku)}
                aria-label="Убрать из поставки"
              >
                <Icon name="X" size={16} />
              </Button>
            )}
            {mode !== 'plan' && onAdd && (mode === 'weak' || l.note === 'Удалено из предложки') && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAdd(l.sku)}>
                {mode === 'skipped' ? 'Вернуть' : 'Добавить'}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default SewLinesList;
