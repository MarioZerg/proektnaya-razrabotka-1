import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchMarketplaceItems,
  createMarketplaceItem,
  updateMarketplaceItem,
  deleteMarketplaceItem,
  fetchMarketplaceItemDetail,
  setMarketplaceItemMaterials,
  type MarketplaceItem,
  type MarketplaceItemMaterial,
} from '@/lib/marketplaceItemsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';

interface ItemFormState {
  name: string;
  sku: string;
  material: string;
  width: string;
  height: string;
}

const emptyForm: ItemFormState = { name: '', sku: '', material: '', width: '', height: '' };

interface MaterialRow {
  workshopId: string;
  materialId: string;
  quantity: string;
}

const MarketplaceItemsSettings = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemFormState>(emptyForm);
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchMarketplaceItems(), fetchWorkshops(), fetchMaterialsData()])
      .then(([itemsData, workshopsData, materialsData]) => {
        setItems(itemsData);
        setWorkshops(workshopsData);
        setMaterials(materialsData.materials);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMaterialRows([]);
    setDialogOpen(true);
  };

  const openEdit = async (item: MarketplaceItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      sku: item.sku || '',
      material: item.material || '',
      width: item.width ? String(item.width) : '',
      height: item.height ? String(item.height) : '',
    });
    setDialogOpen(true);
    const detail = await fetchMarketplaceItemDetail(item.id);
    setMaterialRows(
      detail.materials.map((m: MarketplaceItemMaterial) => ({
        workshopId: m.workshopId ? String(m.workshopId) : '',
        materialId: m.materialId ? String(m.materialId) : '',
        quantity: String(m.quantity),
      }))
    );
  };

  const addMaterialRow = () => {
    setMaterialRows((rows) => [...rows, { workshopId: '', materialId: '', quantity: '' }]);
  };

  const updateMaterialRow = (idx: number, fields: Partial<MaterialRow>) => {
    setMaterialRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...fields } : r)));
  };

  const removeMaterialRow = (idx: number) => {
    setMaterialRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        material: form.material.trim(),
        width: form.width ? Number(form.width) : undefined,
        height: form.height ? Number(form.height) : undefined,
      };

      let itemId = editingId;
      if (editingId) {
        await updateMarketplaceItem(editingId, payload);
      } else {
        const res = await createMarketplaceItem(payload);
        itemId = res.id;
      }

      if (itemId) {
        await setMarketplaceItemMaterials(
          itemId,
          materialRows
            .filter((r) => r.workshopId && r.materialId)
            .map((r) => ({
              workshopId: Number(r.workshopId),
              materialId: Number(r.materialId),
              quantity: Number(r.quantity) || 0,
            }))
        );
      }

      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setMaterialRows([]);
      load();
      toast({ title: editingId ? 'Товар сохранён' : 'Товар создан' });
    } catch (err) {
      toast({
        title: 'Не удалось сохранить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMarketplaceItem(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null);
      toast({
        title: 'Не удалось удалить',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Товары маркетплейса</h1>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingId(null);
                setForm(emptyForm);
                setMaterialRows([]);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="bg-blue-600 text-white hover:bg-blue-700">
                <Icon name="Plus" size={16} className="mr-1.5" />
                Добавить товар
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Изменить товар' : 'Новый товар'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Название</Label>
                  <Input
                    placeholder="Например: Тюль Вуаль 200x265"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Артикул (SKU)</Label>
                  <Input
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label>Материал</Label>
                    <Input
                      value={form.material}
                      onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Ширина</Label>
                    <Input
                      type="number"
                      value={form.width}
                      onChange={(e) => setForm((f) => ({ ...f, width: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Высота</Label>
                    <Input
                      type="number"
                      value={form.height}
                      onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Расход материалов по цехам на заказ</Label>
                    <Button type="button" size="sm" variant="outline" onClick={addMaterialRow}>
                      <Icon name="Plus" size={14} className="mr-1" />
                      Добавить
                    </Button>
                  </div>
                  {materialRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Расход материалов не задан</p>
                  ) : (
                    <div className="space-y-2">
                      {materialRows.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-[1fr_1fr_80px_32px] gap-2">
                          <Select
                            value={row.workshopId}
                            onValueChange={(v) => updateMaterialRow(idx, { workshopId: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Цех" />
                            </SelectTrigger>
                            <SelectContent>
                              {workshops.map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>
                                  {w.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={row.materialId}
                            onValueChange={(v) => updateMaterialRow(idx, { materialId: v })}
                          >
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
                            placeholder="Кол-во"
                            value={row.quantity}
                            onChange={(e) => updateMaterialRow(idx, { quantity: e.target.value })}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeMaterialRow(idx)}
                          >
                            <Icon name="X" size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Товаров пока нет — добавьте первый.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <Card key={item.id} className="border-border shadow-none">
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-start justify-between">
                    <p className="font-medium">{item.name}</p>
                    <div className="flex gap-1">
                      <Button size="icon" variant="secondary" onClick={() => openEdit(item)}>
                        <Icon name="Pencil" size={14} />
                      </Button>
                      <Button size="icon" variant="destructive" onClick={() => setDeleteId(item.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </div>
                  </div>
                  {item.sku && (
                    <Badge variant="secondary" className="font-mono-tech">
                      {item.sku}
                    </Badge>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {item.material || '—'}
                    {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить товар?</AlertDialogTitle>
            <AlertDialogDescription>Действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default MarketplaceItemsSettings;
