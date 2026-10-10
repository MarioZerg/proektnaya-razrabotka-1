import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { RollDetail, RollMovement } from '@/lib/rollsApi';
import { formatDateTime } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';

const movementMeta: Record<RollMovement['kind'], { label: string; icon: string; className: string }> = {
  order: { label: 'Заказ', icon: 'Scissors', className: 'text-sky-600' },
  defect: { label: 'Списание брака', icon: 'TriangleAlert', className: 'text-red-600' },
  return_to_supplier: { label: 'Возврат поставщику', icon: 'Undo2', className: 'text-amber-600' },
  workshop_writeoff: { label: 'Списание в цехе', icon: 'PackageMinus', className: 'text-amber-600' },
  close: { label: 'Рулон закрыт', icon: 'CircleCheck', className: 'text-emerald-600' },
};

const stageIcon: Record<string, string> = {
  cutter: 'Scissors',
  sewer: 'Shirt',
  packer: 'Package',
};

interface RollHistoryProps {
  history: RollDetail['history'];
  untracked: number;
  unit: string;
}

const RollHistory = ({ history, untracked, unit }: RollHistoryProps) => (
  <div className="space-y-2">
    <h2 className="font-semibold">История использования ({history.length})</h2>
    {untracked > 0 && (
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
        <Icon name="Info" size={16} className="mt-0.5 shrink-0 text-amber-600" />
        <p>
          По {formatQuantity(untracked)} {unit} нет записей о расходе — рулон перенесён
          из старой системы вместе с остатком. Движения по заказам записываются с
          момента перехода на терминалы.
        </p>
      </div>
    )}

    {history.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        {untracked > 0
          ? 'Записей о списании по этому рулону не сохранилось'
          : 'Из этого рулона ещё не списывали материал'}
      </p>
    ) : (
      <div className="space-y-3">
        {history.map((m, i) => {
          const meta = movementMeta[m.kind] || movementMeta.order;
          return (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <Icon name={meta.icon} size={16} className={meta.className} />
                  {m.kind === 'order' && m.orderNumber ? `Заказ ${m.orderNumber}` : meta.label}
                  {m.kind === 'defect' && m.defectRoleLabel && (
                    <Badge variant="outline" className="ml-1 capitalize">{m.defectRoleLabel}</Badge>
                  )}
                </span>
                <span className="flex items-center gap-3 text-sm">
                  <span className="font-semibold text-red-600">-{formatQuantity(m.quantity)} {unit}</span>
                  <span className="text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                </span>
              </div>

              {/* Лесенка этапов заказа: кто раскроил → сшил → упаковал */}
              {m.kind === 'order' && m.stages && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {m.stages.map((s, si) => (
                    <div key={s.role} className="flex items-center gap-2">
                      <div
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                          s.userName ? 'border-border bg-muted/40' : 'border-dashed border-border/60'
                        }`}
                      >
                        <Icon
                          name={stageIcon[s.role] || 'User'}
                          size={15}
                          className={s.userName ? 'text-sky-600' : 'text-muted-foreground'}
                        />
                        <div className="leading-tight">
                          <div className="text-[11px] text-muted-foreground">{s.label}</div>
                          <div className={`text-sm ${s.userName ? 'font-medium' : 'text-muted-foreground'}`}>
                            {s.userName || '—'}
                          </div>
                          {s.at && (
                            <div className="text-[10px] text-muted-foreground">{formatDateTime(s.at)}</div>
                          )}
                        </div>
                      </div>
                      {si < m.stages!.length - 1 && (
                        <Icon name="ChevronRight" size={16} className="text-muted-foreground" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Брак / прочие списания: кто зафиксировал и комментарий */}
              {m.kind !== 'order' && (
                <div className="mt-2 text-sm text-muted-foreground">
                  {m.userName ? <span>Зафиксировал: <span className="text-foreground">{m.userName}</span></span> : null}
                  {m.comment ? <span className="ml-2">· {m.comment}</span> : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}
  </div>
);

export default RollHistory;
