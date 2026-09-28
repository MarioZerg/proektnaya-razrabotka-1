import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Supplier } from '@/lib/suppliersApi';
import type { Material } from '@/lib/materialsApi';
import type { ItemRow } from '@/components/crm/shipments/fromSupplierShared';
import {
  addLineToGroup,
  addMaterialGroup,
  groupRowIndices,
  num,
  setGroupField,
} from '@/components/crm/shipments/fromSupplierRows';

const MeterageScanDialog = lazy(
  () => import('@/components/crm/shipments/MeterageScanDialog'),
);

interface SupplyReceiveRowsProps {
  rows: ItemRow[];
  setRows: Dispatch<SetStateAction<ItemRow[]>>;
  materials: Material[];
  suppliers: Supplier[];
  /** Админ: цена и валюта на каждую строку метража. */
  extraLine?: (idx: number, row: ItemRow) => ReactNode;
}

/** 16px на телефоне — иначе iOS зумит поле. Обводка без offset, чтобы не резалась. */
export const receiveFieldClass =
  'h-10 px-2.5 text-base focus-visible:ring-1 focus-visible:ring-offset-0 sm:h-9 sm:text-sm';
export const receiveSelectClass =
  'h-10 px-2.5 text-base focus:ring-1 focus:ring-offset-0 sm:h-9 sm:text-sm';

type PendingFocus = { kind: 'qty' | 'material'; idx: number };
type LastScan = { idx: number; qty: string; created: boolean };

const applyMeterageScan = (
  rows: ItemRow[],
  target: { materialId: string; supplierId: string },
  qty: string,
): { next: ItemRow[]; last: LastScan } => {
  const groups = groupRowIndices(rows);
  const group =
    groups.find(
      (g) =>
        rows[g[0]].materialId === target.materialId &&
        (rows[g[0]].supplierId || '') === target.supplierId,
    ) ?? groups[groups.length - 1];
  const scanned = { quantity: qty, numberRolls: '1' };
  if (!group) return { next: rows, last: { idx: -1, qty, created: false } };
  const emptyIdx = [...group].reverse().find((i) => !rows[i].quantity.trim());
  if (emptyIdx !== undefined) {
    return {
      next: rows.map((row, i) => (i === emptyIdx ? { ...row, ...scanned } : row)),
      last: { idx: emptyIdx, qty, created: false },
    };
  }
  const lastIdx = group[group.length - 1];
  return {
    next: addLineToGroup(rows, group).map((row, i) =>
      i === lastIdx + 1 ? { ...row, ...scanned } : row,
    ),
    last: { idx: lastIdx + 1, qty, created: true },
  };
};

/**
 * Состав приёмки: материал и поставщик один раз на блок, дальше строки метража.
 * Поставщик обязателен у ткани — отдельного «основного» нет.
 */
const SupplyReceiveRows = ({
  rows,
  setRows,
  materials,
  suppliers,
  extraLine,
}: SupplyReceiveRowsProps) => {
  const groups = groupRowIndices(rows);
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const materialRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<{
    materialId: string;
    supplierId: string;
    materialName: string;
    unit: string;
  } | null>(null);
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  const pendingLastScan = useRef<LastScan | null>(null);
  const scanTargetRef = useRef(scanTarget);
  scanTargetRef.current = scanTarget;

  useLayoutEffect(() => {
    if (pendingLastScan.current) {
      setLastScan(pendingLastScan.current);
      pendingLastScan.current = null;
    }
    const pending = pendingFocus.current;
    if (!pending) return;
    // Пока открыт сканер, не уводим фокус на поле за ним — иначе на телефоне
    // всплывает клавиатура. После закрытия сканера фокус встанет на метраж.
    if (scanOpen) return;
    pendingFocus.current = null;
    const el =
      pending.kind === 'qty'
        ? qtyRefs.current[pending.idx]
        : materialRefs.current[pending.idx];
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (pending.kind === 'qty' && 'select' in el) el.select();
  }, [rows, scanOpen]);

  const materialUnit = (materialId: string) =>
    materials.find((m) => String(m.id) === materialId)?.unit || '';

  const updateRow = (idx: number, field: keyof ItemRow, value: string) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const removeRow = (idx: number) =>
    setRows((r) => (r.length <= 1 ? r : r.filter((_, i) => i !== idx)));

  const addLine = (group: number[]) => {
    pendingFocus.current = { kind: 'qty', idx: group[group.length - 1] + 1 };
    setRows((r) => addLineToGroup(r, group));
  };

  const addMaterial = () => {
    pendingFocus.current = { kind: 'material', idx: rows.length };
    setRows((r) => addMaterialGroup(r));
  };

  const applyScannedMeterage = (qty: string) => {
    const target = scanTargetRef.current;
    if (!target) return;
    setRows((r) => {
      const result = applyMeterageScan(r, target, qty);
      pendingLastScan.current = result.last;
      if (result.last.idx >= 0) {
        pendingFocus.current = { kind: 'qty', idx: result.last.idx };
      }
      return result.next;
    });
  };

  const undoLastScan = () => {
    const last = lastScan;
    if (!last || last.idx < 0) return;
    setRows((r) => {
      if (last.idx >= r.length) return r;
      if (r[last.idx].quantity !== last.qty) return r;
      if (last.created) {
        if (r.length <= 1) {
          return r.map((row, i) =>
            i === last.idx ? { ...row, quantity: '', numberRolls: '' } : row,
          );
        }
        return r.filter((_, i) => i !== last.idx);
      }
      return r.map((row, i) =>
        i === last.idx ? { ...row, quantity: '', numberRolls: '' } : row,
      );
    });
    setLastScan(null);
  };

  const last = rows[rows.length - 1];
  const canAddMaterial = Boolean(last?.materialId && last?.supplierId);

  /** Пустые рулоны при заполненном метраже = 1, как при сохранении. */
  const lineRolls = (row: ItemRow) => {
    if (!(num(row.quantity) > 0)) return 0;
    const r = num(row.numberRolls);
    return r >= 1 ? Math.floor(r) : 1;
  };

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const head = rows[group[0]];
        const unit = materialUnit(head.materialId) || 'ед.';
        const filled = group
          .map((idx, lineNo) => {
            const rolls = lineRolls(rows[idx]);
            if (!rolls) return null;
            const qty = num(rows[idx].quantity);
            return { n: lineNo + 1, qty, rolls, total: qty * rolls };
          })
          .filter((x): x is { n: number; qty: number; rolls: number; total: number } => x != null);
        const sumQty = filled.reduce((s, x) => s + x.total, 0);
        const sumRolls = filled.reduce((s, x) => s + x.rolls, 0);
        return (
          <div
            key={`${group[0]}-${head.materialId}-${head.supplierId || ''}`}
            className="min-w-0 space-y-1.5 rounded-md border border-border p-2"
          >
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center">
              <Select
                value={head.materialId || undefined}
                onValueChange={(v) =>
                  setRows((r) => setGroupField(r, group, 'materialId', v))
                }
              >
                <SelectTrigger
                  ref={(el) => {
                    materialRefs.current[group[0]] = el;
                  }}
                  className={`${receiveSelectClass} min-w-0 w-full sm:flex-1`}
                >
                  <SelectValue placeholder="Материал" />
                </SelectTrigger>
                <SelectContent>
                  {materials.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name} ({m.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={head.supplierId || undefined}
                onValueChange={(v) =>
                  setRows((r) => setGroupField(r, group, 'supplierId', v))
                }
              >
                <SelectTrigger
                  title="От кого приехал этот материал"
                  className={`${receiveSelectClass} min-w-0 w-full sm:flex-1`}
                >
                  <SelectValue placeholder="Поставщик" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              {group.map((idx, lineNo) => {
                const row = rows[idx];
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                        {lineNo + 1}
                      </span>
                      <Input
                        ref={(el) => {
                          qtyRefs.current[idx] = el;
                        }}
                        type="number"
                        step="0.01"
                        min="0.01"
                        inputMode="decimal"
                        autoComplete="off"
                        title="Сколько в одном рулоне"
                        placeholder={unit !== 'ед.' ? `В рулоне, ${unit}` : 'В одном рулоне'}
                        className={`${receiveFieldClass} min-w-0 flex-1`}
                        value={row.quantity}
                        onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                      />
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        inputMode="numeric"
                        autoComplete="off"
                        title="Сколько таких рулонов пришло"
                        placeholder="шт"
                        className={`${receiveFieldClass} w-[4.75rem] shrink-0 sm:w-20`}
                        value={row.numberRolls}
                        onChange={(e) => updateRow(idx, 'numberRolls', e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 w-10 shrink-0 p-0 text-muted-foreground hover:text-destructive focus-visible:ring-1 focus-visible:ring-offset-0 sm:h-9 sm:w-9"
                        onClick={() => removeRow(idx)}
                        disabled={rows.length === 1}
                        title="Убрать строку"
                      >
                        <Icon name="X" size={16} />
                      </Button>
                    </div>
                    {extraLine && (
                      <div className="grid grid-cols-2 gap-1.5 pl-5">{extraLine(idx, row)}</div>
                    )}
                    {(row.reservedBarcodes?.length ?? 0) > 0 && (
                      <p className="truncate pl-5 font-mono-tech text-[11px] text-muted-foreground">
                        {(row.reservedBarcodes || []).join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 w-full focus-visible:ring-1 focus-visible:ring-offset-0 sm:h-9"
                disabled={!head.materialId}
                onClick={() => addLine(group)}
              >
                <Icon name="Plus" size={14} className="mr-1" />
                Строка
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-10 w-full focus-visible:ring-1 focus-visible:ring-offset-0 sm:h-9"
                disabled={!head.materialId}
                title={
                  head.materialId
                    ? 'Камера: считать метраж с бирки рулона'
                    : 'Сначала выберите материал'
                }
                onClick={() => {
                  const mat = materials.find((m) => String(m.id) === head.materialId);
                  setScanTarget({
                    materialId: head.materialId,
                    supplierId: head.supplierId || '',
                    materialName: mat?.name || '',
                    unit: mat?.unit || 'м',
                  });
                  setScanOpen(true);
                }}
              >
                <Icon name="Camera" size={14} className="mr-1" />
                Камера
              </Button>
            </div>

            {filled.length > 0 && (
              <div className="rounded-md bg-muted/50 px-2 py-1.5 text-xs tabular-nums">
                <ul className="space-y-0.5 text-muted-foreground">
                  {filled.map((x) => (
                    <li key={x.n}>
                      {x.n}. {x.qty.toLocaleString('ru-RU')} {unit} × {x.rolls} рул. ={' '}
                      {x.total.toLocaleString('ru-RU')} {unit}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 font-medium text-foreground">
                  Итого: {sumQty.toLocaleString('ru-RU')} {unit}
                  <span className="font-normal text-muted-foreground"> · {sumRolls} рул.</span>
                </p>
              </div>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-10 w-full focus-visible:ring-1 focus-visible:ring-offset-0 sm:h-9 sm:w-auto"
        disabled={!canAddMaterial}
        onClick={addMaterial}
      >
        <Icon name="Plus" size={14} className="mr-1" />
        Добавить материал
      </Button>

      <p className="text-xs text-muted-foreground">
        Поставщик указывается у каждой ткани. Другая ткань того же поставщика — «Добавить
        материал». Скан с камеры — одна строка: метраж с бирки и 1 рулон. Следующий
        рулон — снова навести и считать.
      </p>

      {scanOpen && (
        <Suspense fallback={null}>
          <MeterageScanDialog
            open={scanOpen}
            onOpenChange={setScanOpen}
            onMeterage={applyScannedMeterage}
            lastQty={lastScan && lastScan.idx >= 0 ? lastScan.qty : null}
            onUndoLast={undoLastScan}
            unit={scanTarget?.unit || 'м'}
          />
        </Suspense>
      )}
    </div>
  );
};

export default SupplyReceiveRows;
