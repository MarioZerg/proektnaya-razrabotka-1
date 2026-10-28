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
import {
  fetchMarketplaceItemDetail,
  setMarketplaceItemMaterials,
  type MarketplaceItem,
} from '@/lib/marketplaceItemsApi';
import type { Material } from '@/lib/materialsApi';

interface Row {
  materialId: string;
  quantity: string;
}

interface Props {
  item: Pick<MarketplaceItem, 'id' | 'name' | 'article'> | null;
  materials: Material[];
  onClose: () => void;
  onSaved: () => void;
}

/** Расход материалов склада на один артикул размера. Живёт только в ERP. */
const SiteItemMaterialsDialog = ({ item, materials, onClose, onSaved }: Props) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setLoading(true);
    setRows([]);
    fetchMarketplaceItemDetail(item.id)
      .then((d) => {
        const list = d.materials.map((m) => ({
          materialId: m.materialId ? String(m.materialId) : '',
          quantity: String(m.quantity),
        }));
        setRows(list.length ? list : [{ materialId: '', quantity: '' }]);
      })
      .catch(() => setRows([{ materialId: '', quantity: '' }]))
      .finally(() => setLoading(false));
  }, [item]);

  const update = (idx: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await setMarketplaceItemMaterials(
        item.id,
        rows
          .filter((r) => r.materialId)
          .map((r) => ({ materialId: Number(r.materialId), quantity: Number(r.quantity) || 0 }))
      );
      toast({ title: 'Расход сохранён', description: item.article || item.name });
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

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-words">{item?.name}</DialogTitle>
        </DialogHeader>
        <p className="font-mono text-xs text-muted-foreground">{item?.article}</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка расхода…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Расход материалов склада</Label>
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
            {rows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_100px_32px] gap-2">
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
              Расход хранится только в ERP: загрузка с сайта его не меняет.
            </p>
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SiteItemMaterialsDialog;
