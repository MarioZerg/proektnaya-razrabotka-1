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
  type Shop,
} from '@/lib/marketplaceItemsApi';
import ShopTabs from '@/components/crm/ShopTabs';
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

  // Магазин, ассортимент которого сейчас смотрят. Кабинеты МЕГАТЮЛЬ и ДЮНА
  // разные, и карточки нельзя показывать вперемешку: товар одного магазина,
  // добавленный в поставку другого, уедет не туда.
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);

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
      .then(({ items: list, shops: shopList }) => {
        setItems(list);
        setShops(shopList);
        // При первом заходе открываем первый магазин, а не «все»: работают
        // всегда в контексте одного кабинета.
        setShopId((prev) => prev ?? shopList[0]?.id ?? null);
      })
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
        // Новый товар заводим в тот магазин, вкладка которого открыта, —
        // иначе карточка исчезнет из виду сразу после создания.
        if (!shopId) return;
        const res = await createMarketplaceItem({ ...payload, shopId });
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
    // Тянем карточки того кабинета, чья вкладка открыта: ключи площадок
    // у магазинов разные, общей синхронизации не бывает.
    if (!shopId) return;
    setSyncing(true);
    try {
      const res = await syncMarketplaceItems(shopId);
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

  // Счётчик карточек по магазинам — видно, что у нового магазина ассортимент
  // ещё не заведён, без переключения вкладок.
  const shopCounts = items.reduce<Record<number, number>>((acc, item) => {
    acc[item.shopId] = (acc[item.shopId] || 0) + 1;
    return acc;
  }, {});

  // Всё остальное на странице (материалы в фильтре, счётчики, пагинация)
  // считаем уже внутри выбранного магазина.
  const shopItems = shopId === null ? items : items.filter((i) => i.shopId === shopId);
  const currentShop = shops.find((s) => s.id === shopId) || null;

  const materialOptions = Array.from(
    new Set(shopItems.map((i) => i.material).filter((m): m is string => !!m))
  ).sort((a, b) => a.localeCompare(b));

  const filteredItems = shopItems.filter((item) => {
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
      <div className="min-w-0 space-y-6 overflow-x-hidden">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold">Товары маркетплейса</h1>
            {!loading && (
              <Badge variant="secondary" className="max-w-full text-sm font-normal">
                {currentShop ? `Товаров в «${currentShop.name}»` : 'Всего товаров'}:{' '}
                {shopItems.length}
              </Badge>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSync}
              disabled={syncing}
              className="min-w-0 max-w-full"
            >
              <Icon
                name={syncing ? 'Loader2' : 'RefreshCw'}
                size={16}
                className={`mr-1.5 shrink-0 ${syncing ? 'animate-spin' : ''}`}
              />
              <span className="min-w-0 truncate">
                {syncing
                  ? 'Синхронизация…'
                  : currentShop
                    ? `Синхронизировать «${currentShop.name}»`
                    : 'Синхронизировать карточки'}
              </span>
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

        {!loading && (
          <ShopTabs
            shops={shops}
            value={shopId}
            onChange={(id) => {
              setShopId(id);
              setPage(1);
            }}
            counts={shopCounts}
          />
        )}

        {!loading && shopItems.length > 0 && (
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
          items={shopItems}
          emptyLabel={
            currentShop
              ? `В магазине «${currentShop.name}» товаров пока нет — добавьте первый или синхронизируйте карточки с площадок.`
              : undefined
          }
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