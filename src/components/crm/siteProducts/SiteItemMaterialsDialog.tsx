import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchMarketplaceItemDetail, setMarketplaceItemMaterials } from '@/lib/marketplaceItemsApi';
import type { Material } from '@/lib/materialsApi';

interface Row {
  materialId: string;
  quantity: string;
}

export interface MaterialsDialogGroup {
  title: string;
  width: number | null;
  items: { id: number; height: number | null; article: string | null }[];
}

interface Props {
  group: MaterialsDialogGroup | null;
  materials: Material[];
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: Row[] = [{ materialId: '', quantity: '' }];
const sig = (rows: Row[]) =>
  JSON.stringify(rows.filter((r) => r.materialId).map((r) => [r.materialId, Number(r.quantity) || 0]));

/** Расход ширины с переключением по высотам: у разных высот могут быть разные пакеты. */
const SiteItemMaterialsDialog = ({ group, materials, onClose, onSaved }: Props) => {
  const { toast } = useToast();
  const [rowsById, setRowsById] = useState<Record<number, Row[]>>({});
  const [initial, setInitial] = useState<Record<number, string>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!group) return;
    setLoading(true);
    setRowsById({});
    setActiveId(group.items[0]?.id ?? null);
    Promise.all(
      group.items.map((it) =>
        fetchMarketplaceItemDetail(it.id)
          .then((d) =>
            d.materials.map((m) => ({
              materialId: m.materialId ? String(m.materialId) : '',
              quantity: String(m.quantity),
            }))
          )
          .catch(() => [] as Row[])
      )
    )
      .then((lists) => {
        const rows: Record<number, Row[]> = {};
        const init: Record<number, string> = {};
        group.items.forEach((it, idx) => {
          rows[it.id] = lists[idx].length ? lists[idx] : EMPTY;
          init[it.id] = sig(lists[idx]);
        });
        setRowsById(rows);
        setInitial(init);
      })
      .finally(() => setLoading(false));
  }, [group]);

  const rows = activeId != null ? rowsById[activeId] || EMPTY : EMPTY;
  const setRows = (fn: (r: Row[]) => Row[]) =>
    activeId != null && setRowsById((s) => ({ ...s, [activeId]: fn(s[activeId] || EMPTY) }));
  const update = (idx: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const dirtyIds = group ? group.items.filter((it) => sig(rowsById[it.id] || []) !== initial[it.id]).map((it) => it.id) : [];
  const emptyCount = group ? group.items.filter((it) => sig(rowsById[it.id] || []) === '[]').length : 0;

  const copyToAll = () => {
    if (!group || activeId == null) return;
    const src = rowsById[activeId] || EMPTY;
    setRowsById(Object.fromEntries(group.items.map((it) => [it.id, src.map((r) => ({ ...r }))])));
    toast({ title: `Расход скопирован на все высоты: ${group.items.length}`, description: 'Не забудьте сохранить' });
  };

  const save = async () => {
    if (!group || dirtyIds.length === 0) return;
    setSaving(true);
    try {
      for (const id of dirtyIds) {
        await setMarketplaceItemMaterials(
          id,
          (rowsById[id] || [])
            .filter((r) => r.materialId)
            .map((r) => ({ materialId: Number(r.materialId), quantity: Number(r.quantity) || 0 }))
        );
      }
      toast({ title: 'Расход сохранён', description: `Изменено высот: ${dirtyIds.length}` });
      onSaved();
      onClose();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const active = group?.items.find((it) => it.id === activeId);

  return (
    <Dialog open={!!group} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="break-words">
            {group?.title} · ширина {group?.width ?? '—'} см
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка расхода…
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Высота</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {group?.items.map((it) => {
                  const isActive = it.id === activeId;
                  const empty = sig(rowsById[it.id] || []) === '[]';
                  const dirty = dirtyIds.includes(it.id);
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setActiveId(it.id)}
                      className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : empty
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            : 'bg-muted text-muted-foreground hover:bg-muted/70'
                      }`}
                      title={empty ? 'Расход не проставлен' : undefined}
                    >
                      {it.height ?? '—'}
                      {dirty ? ' •' : ''}
                    </button>
                  );
                })}
              </div>
              {active?.article && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">{active.article}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label>Расход материалов</Label>
              <div className="flex gap-1">
                {group && group.items.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={copyToAll}>
                    <Icon name="Copy" size={14} className="mr-1" />
                    На все высоты
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRows((r) => [...r, { materialId: '', quantity: '' }])}
                >
                  <Icon name="Plus" size={14} className="mr-1" />
                  Добавить
                </Button>
              </div>
            </div>

            {rows.map((row, idx) => (
              <div key={`${activeId}-${idx}`} className="grid grid-cols-[1fr_100px_32px] gap-2">
                <Select value={row.materialId} onValueChange={(v) => update(idx, { materialId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Материал" />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Кол-во"
                  value={row.quantity}
                  onChange={(e) => update(idx, { quantity: e.target.value })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setRows((r) => r.filter((_, i) => i !== idx))}
                >
                  <Icon name="X" size={14} />
                </Button>
              </div>
            ))}

            <p className="text-xs text-muted-foreground">
              У каждой высоты свой расход — например, другой пакет. Жёлтым отмечены высоты без расхода
              {emptyCount ? ` (${emptyCount})` : ''}, точкой — изменённые. Хранится только в ERP.
            </p>
            <Button className="w-full" onClick={save} disabled={saving || dirtyIds.length === 0}>
              {saving ? (
                <Icon name="Loader2" size={16} className="animate-spin" />
              ) : dirtyIds.length ? (
                `Сохранить (${dirtyIds.length})`
              ) : (
                'Нет изменений'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SiteItemMaterialsDialog;
