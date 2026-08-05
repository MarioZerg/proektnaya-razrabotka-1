import { useEffect, useMemo, useState } from 'react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import Icon from '@/components/ui/icon';
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

const NEW_TYPE_VALUE = '__new__';
const PAGE_SIZE = 10;

interface MaterialFormState {
  typeId: string;
  newTypeName: string;
  name: string;
  unit: string;
  cost: string;
  status: 'active' | 'archive';
}

const emptyForm: MaterialFormState = {
  typeId: '',
  newTypeName: '',
  name: '',
  unit: 'шт',
  cost: '',
  status: 'active',
};

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
      cost: String(m.cost),
      status: m.status,
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

      const cost = parseFloat(form.cost.replace(',', '.')) || 0;

      if (editingId) {
        await updateMaterial(editingId, {
          name: form.name.trim(),
          unit: form.unit.trim() || 'шт',
          cost,
          status: form.status,
          typeId,
        });
      } else {
        await createMaterial(typeId, form.name.trim(), form.unit.trim() || 'шт', cost, form.status);
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
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Материалы</h1>

          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingId(null);
                setForm(emptyForm);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>Добавить материал</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Изменить материал' : 'Новый материал'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Тип</Label>
                  <Select
                    value={form.typeId}
                    onValueChange={(v) => setForm((f) => ({ ...f, typeId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите тип" />
                    </SelectTrigger>
                    <SelectContent>
                      {types.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NEW_TYPE_VALUE}>+ Создать новый тип</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.typeId === NEW_TYPE_VALUE && (
                    <Input
                      className="mt-2"
                      placeholder="Название нового типа"
                      value={form.newTypeName}
                      onChange={(e) => setForm((f) => ({ ...f, newTypeName: e.target.value }))}
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Название</Label>
                  <Input
                    placeholder="Например: Вуаль"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Ед. измерения</Label>
                    <Input
                      placeholder="п.м. / шт"
                      value={form.unit}
                      onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Себестоимость</Label>
                    <Input
                      placeholder="0"
                      value={form.cost}
                      onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Статус</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm((f) => ({ ...f, status: v as 'active' | 'archive' }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Активен</SelectItem>
                      <SelectItem value="archive">Архив</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? (
                    <Icon name="Loader2" size={16} className="animate-spin" />
                  ) : editingId ? (
                    'Сохранить'
                  ) : (
                    'Создать'
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Группы материалов: пустую группу можно удалить прямо здесь, чтобы в справочнике
            не висели лишние категории. Группа с материалами не удаляется. */}
        {types.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Группы материалов</p>
            <div className="flex flex-wrap gap-2">
              {types.map((t) => {
                const count = materials.filter((m) => m.typeId === t.id).length;
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground">{count} шт</span>
                    {count === 0 && (
                      <button
                        onClick={() => handleDeleteType(t.id, t.name)}
                        className="text-muted-foreground transition hover:text-destructive"
                        aria-label={`Удалить группу ${t.name}`}
                      >
                        <Icon name="X" size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">Материалов пока нет — добавьте первый.</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Тип</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Ед.измерения</TableHead>
                  <TableHead className="text-primary-foreground">Себестоимость</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedMaterials.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.id}</TableCell>
                    <TableCell>{typeById.get(m.typeId) || '—'}</TableCell>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.unit}</TableCell>
                    <TableCell>{m.cost} руб.</TableCell>
                    <TableCell>
                      <Badge variant={m.status === 'active' ? 'secondary' : 'outline'}>
                        {m.status === 'active' ? 'Активен' : 'Архив'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="icon" variant="secondary" onClick={() => openEditDialog(m)}>
                          <Icon name="Pencil" size={14} />
                        </Button>
                        {m.hasMovements ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button size="icon" variant="destructive" disabled>
                                  <Icon name="Lock" size={14} />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Материал участвовал в движениях по заказам — удалить нельзя
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button
                            size="icon"
                            variant="destructive"
                            onClick={() => setDeleteId(m.id)}
                          >
                            <Icon name="Trash2" size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              size="icon"
              variant="outline"
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
                onClick={() => setPage(p)}
              >
                {p}
              </Button>
            ))}
            <Button
              size="icon"
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <Icon name="ChevronRight" size={16} />
            </Button>
          </div>
        )}
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