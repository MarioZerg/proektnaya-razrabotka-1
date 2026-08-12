import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchMarketplaceItems,
  createMarketplaceItem,
  updateMarketplaceItem,
  deleteMarketplaceItem,
  fetchMarketplaceItemDetail,
  setMarketplaceItemMaterials,
  syncMarketplaceItems,
  type MarketplaceItem,
  type MarketplaceItemMaterial,
} from '@/lib/marketplaceItemsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import {
  emptyForm,
  PAGE_SIZE,
  ALL_MATERIALS,
  type ItemFormState,
  type MaterialRow,
} from '@/components/crm/marketplaceItems/marketplaceItemsShared';
import ItemFormDialog from '@/components/crm/marketplaceItems/ItemFormDialog';
import ItemsToolbar from '@/components/crm/marketplaceItems/ItemsToolbar';
import ItemsGrid from '@/components/crm/marketplaceItems/ItemsGrid';

const MarketplaceItemsSettings = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  const [skuQuery, setSkuQuery] = useState('');
  const [materialFilter, setMaterialFilter] = useState(ALL_MATERIALS);
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ItemFormState>(emptyForm);
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    setLoading(true);
    // Справочник материалов запрашиваем отдельно: если он не дошёл из-за обрыва связи,
    // список товаров всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchMaterialsData()
      .then((materialsData) => setMaterials(materialsData.materials))
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchMarketplaceItems()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMaterialRows([{ materialId: '', quantity: '' }]);
    setDialogOpen(true);
  };

  const openEdit = async (item: MarketplaceItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      width: item.width ? String(item.width) : '',
      height: item.height ? String(item.height) : '',
      article: item.article || '',
      ozonSku: item.ozonSku || '',
      wbSku: item.wbSku || '',
      ymSku: item.ymSku || '',
      material: item.material || '',
      barcode: item.barcode || '',
    });
    setDialogOpen(true);
    const detail = await fetchMarketplaceItemDetail(item.id);
    const rows = detail.materials.map((m: MarketplaceItemMaterial) => ({
      materialId: m.materialId ? String(m.materialId) : '',
      quantity: String(m.quantity),
    }));
    setMaterialRows(rows.length > 0 ? rows : [{ materialId: '', quantity: '' }]);
  };

  const addMaterialRow = () => {
    setMaterialRows((rows) => [...rows, { materialId: '', quantity: '' }]);
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
        article: form.article.trim(),
        ozonSku: form.ozonSku.trim(),
        wbSku: form.wbSku.trim(),
        ymSku: form.ymSku.trim(),
        material: form.material.trim(),
        barcode: form.barcode.trim(),
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
            .filter((r) => r.materialId)
            .map((r) => ({
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

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncMarketplaceItems();
      const warn = res.warnings.length ? ` Предупреждения: ${res.warnings.join('; ')}` : '';
      toast({
        title: `Синхронизация завершена`,
        description:
          `Добавлено новых: ${res.created}. Всего карточек с площадок: ${res.totalArticles} ` +
          `(OZON ${res.ozonCards}, WB ${res.wbCards}).` + warn,
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось синхронизировать',
        description: err instanceof Error ? err.message : 'Проверьте ключи OZON/WB в интеграциях',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const materialOptions = Array.from(
    new Set(items.map((i) => i.material).filter((m): m is string => !!m))
  ).sort((a, b) => a.localeCompare(b));

  const filteredItems = items.filter((item) => {
    const matchesSku = skuQuery.trim()
      ? (item.article || '').toLowerCase().includes(skuQuery.trim().toLowerCase())
      : true;
    const matchesMaterial =
      materialFilter === ALL_MATERIALS ? true : item.material === materialFilter;
    return matchesSku && matchesMaterial;
  });

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Товары маркетплейса</h1>
            {!loading && (
              <Badge variant="secondary" className="text-sm font-normal">
                Всего товаров: {items.length}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <Icon
                name={syncing ? 'Loader2' : 'RefreshCw'}
                size={16}
                className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
              />
              {syncing ? 'Синхронизация…' : 'Синхронизировать карточки'}
            </Button>

          <ItemFormDialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingId(null);
                setForm(emptyForm);
                setMaterialRows([]);
              }
            }}
            editingId={editingId}
            form={form}
            setForm={setForm}
            materials={materials}
            materialRows={materialRows}
            addMaterialRow={addMaterialRow}
            updateMaterialRow={updateMaterialRow}
            removeMaterialRow={removeMaterialRow}
            saving={saving}
            onOpenCreate={openCreate}
            onSave={handleSave}
          />
          </div>
        </div>

        {!loading && items.length > 0 && (
          <ItemsToolbar
            skuQuery={skuQuery}
            setSkuQuery={setSkuQuery}
            materialFilter={materialFilter}
            setMaterialFilter={setMaterialFilter}
            setPage={setPage}
            materialOptions={materialOptions}
            filteredCount={filteredItems.length}
          />
        )}

        <ItemsGrid
          loading={loading}
          items={items}
          filteredItems={filteredItems}
          pagedItems={pagedItems}
          currentPage={currentPage}
          totalPages={totalPages}
          setPage={setPage}
          onEdit={openEdit}
          deleteId={deleteId}
          setDeleteId={setDeleteId}
          onDelete={handleDelete}
        />
      </div>
    </CrmLayout>
  );
};

export default MarketplaceItemsSettings;