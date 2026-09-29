import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchSuppliers, deleteSupplier, type Supplier } from '@/lib/suppliersApi';
import SupplierCard from '@/components/crm/suppliers/SupplierCard';
import SupplierCardDialog, {
  type SupplierFormSection,
} from '@/components/crm/suppliers/SupplierCardDialog';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const PAGE_SIZE = 12;

const SuppliersSettings = () => {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [focusSection, setFocusSection] = useState<SupplierFormSection>('contacts');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchSuppliers()
      .then((list) => {
        setListError(null);
        setSuppliers(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить поставщиков');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      [s.name, s.phone, s.address, s.comment]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [suppliers, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const openCreate = () => {
    setEditing(null);
    setFocusSection('contacts');
    setDialogOpen(true);
  };

  const openCard = (s: Supplier, section: SupplierFormSection) => {
    setEditing(s);
    setFocusSection(section);
    setDialogOpen(true);
  };

  const closeCard = () => {
    setDialogOpen(false);
    setEditing(null);
    setFocusSection('contacts');
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedSuppliers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteSupplier(deleteId);
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
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-bold">Поставщики</h1>
          <Button
            onClick={openCreate}
            className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700 sm:h-10 sm:w-auto"
          >
            <Icon name="Plus" size={16} className="mr-1.5" />
            Добавить поставщика
          </Button>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить поставщиков"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && suppliers.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : suppliers.length === 0 ? (
          listError ? null : (
            <p className="text-sm text-muted-foreground">Поставщиков пока нет.</p>
          )
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Icon
                name="Search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск: название, телефон или адрес"
                className="h-11 pl-9 sm:h-10"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {search.trim()
                ? `Найдено: ${filtered.length}`
                : `Поставщиков: ${suppliers.length}`}
            </p>
            {pagedSuppliers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Никого не нашли.</p>
            ) : (
              <div className="space-y-2">
                {pagedSuppliers.map((s) => (
                  <SupplierCard
                    key={s.id}
                    supplier={s}
                    onPrices={(item) => openCard(item, 'prices')}
                    onEdit={(item) => openCard(item, 'contacts')}
                    onDelete={setDeleteId}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="h-11 w-11 sm:h-10 sm:w-10"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <Icon name="ChevronLeft" size={16} />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                size="icon"
                variant={p === page ? 'default' : 'outline'}
                className="h-11 w-11 sm:h-10 sm:w-10"
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button
              size="icon"
              variant="outline"
              className="h-11 w-11 sm:h-10 sm:w-10"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <Icon name="ChevronRight" size={16} />
            </Button>
          </div>
        )}
      </div>

      <SupplierCardDialog
        key={`${editing?.id ?? 'new'}-${focusSection}-${dialogOpen ? 'open' : 'closed'}`}
        open={dialogOpen}
        supplier={editing}
        focusSection={focusSection}
        onClose={closeCard}
        onSaved={load}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить поставщика?</AlertDialogTitle>
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

export default SuppliersSettings;
