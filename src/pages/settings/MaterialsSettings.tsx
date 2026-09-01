import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
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
import { useToast } from '@/hooks/use-toast';
import {
  fetchMaterialsData,
  createType,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  deleteMaterialType,
  type Material,
  type MaterialType,
} from '@/lib/materialsApi';
import MaterialFormDialog from '@/components/crm/materials/MaterialFormDialog';
import MaterialTypesRow from '@/components/crm/materials/MaterialTypesRow';
import MaterialsTable from '@/components/crm/materials/MaterialsTable';
import {
  NEW_TYPE_VALUE,
  PAGE_SIZE,
  emptyForm,
  type MaterialFormState,
} from '@/components/crm/materials/materialsSettingsShared';

const MaterialsSettings = () => {
  const { toast } = useToast();
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MaterialFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchMaterialsData()
      .then((data) => {
        setTypes(data.types);
        setMaterials(data.materials);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const typeById = useMemo(() => {
    const map = new Map<number, string>();
    types.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [types]);

  const totalPages = Math.max(1, Math.ceil(materials.length / PAGE_SIZE));
  const pagedMaterials = materials.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreateDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (m: Material) => {
    setEditingId(m.id);
    setForm({
      typeId: String(m.typeId),
      newTypeName: '',
      name: m.name,
      unit: m.unit,
      status: m.status,
      requiresOverlock: !!m.requiresOverlock,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;

    setSaving(true);
    try {
      let typeId = Number(form.typeId);

      if (form.typeId === NEW_TYPE_VALUE) {
        if (!form.newTypeName.trim()) {
          setSaving(false);
          return;
        }
        const res = await createType(form.newTypeName.trim());
        typeId = res.id;
      }

      if (!typeId) {
        setSaving(false);
        return;
      }

      if (editingId) {
        await updateMaterial(editingId, {
          name: form.name.trim(),
          unit: form.unit.trim() || 'шт',
          status: form.status,
          requiresOverlock: form.requiresOverlock,
          typeId,
        });
      } else {
        await createMaterial(
          typeId,
          form.name.trim(),
          form.unit.trim() || 'шт',
          form.status,
          form.requiresOverlock
        );
      }

      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMaterial(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null);
      toast({
        title: 'Нельзя удалить материал',
        description: err instanceof Error ? err.message : 'Попробуйте позже',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteType = async (id: number, name: string) => {
    if (!confirm(`Удалить группу «${name}»?`)) return;
    try {
      await deleteMaterialType(id);
      toast({ title: `Группа «${name}» удалена` });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось удалить группу',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Материалы</h1>

          <MaterialFormDialog
            dialogOpen={dialogOpen}
            onDialogOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingId(null);
                setForm(emptyForm);
              }
            }}
            onCreateClick={openCreateDialog}
            types={types}
            editingId={editingId}
            form={form}
            setForm={setForm}
            saving={saving}
            onSave={handleSave}
          />
        </div>

        <MaterialTypesRow
          types={types}
          materials={materials}
          onDeleteType={handleDeleteType}
        />

        <MaterialsTable
          loading={loading}
          materials={materials}
          pagedMaterials={pagedMaterials}
          typeById={typeById}
          page={page}
          totalPages={totalPages}
          setPage={setPage}
          onEdit={openEditDialog}
          onAskDelete={setDeleteId}
        />
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить материал?</AlertDialogTitle>
            <AlertDialogDescription>
              Материал исчезнет из справочника и из таблицы на складе.
            </AlertDialogDescription>
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

export default MaterialsSettings;
