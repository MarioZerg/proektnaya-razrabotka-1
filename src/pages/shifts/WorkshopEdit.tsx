import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchWorkshopDetail,
  updateWorkshop,
  type WorkshopDetail,
} from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { workshopSettingsConfig } from '@/lib/workshopSettingsConfig';

const WorkshopEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [workshop, setWorkshop] = useState<WorkshopDetail | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [allowedProducts, setAllowedProducts] = useState<Set<number>>(new Set());
  const [allowedMaterials, setAllowedMaterials] = useState<Set<number>>(new Set());
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([fetchWorkshopDetail(Number(id)), fetchMaterialsData()])
      .then(([w, materialsData]) => {
        setWorkshop(w);
        setMaterials(materialsData.materials.filter((m) => m.status === 'active'));
        setName(w.name);
        setStatus(w.isActive ? 'active' : 'inactive');
        setAllowedProducts(new Set(w.allowedProducts));
        setAllowedMaterials(new Set(w.allowedMaterials));
        const initialValues: Record<string, string> = {};
        Object.entries(w.settings).forEach(([key, field]) => {
          initialValues[key] = field.value ?? '';
        });
        setSettingsValues(initialValues);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const toggleSet = (set: Set<number>, value: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const materialsByType = useMemo(() => {
    const groups = new Map<number, Material[]>();
    materials.forEach((m) => {
      const arr = groups.get(m.typeId) || [];
      arr.push(m);
      groups.set(m.typeId, arr);
    });
    return groups;
  }, [materials]);

  const handleSave = async () => {
    if (!workshop) return;
    setSaving(true);
    try {
      const settingsPayload: Record<string, string | null> = {};
      Object.entries(settingsValues).forEach(([key, value]) => {
        settingsPayload[key] = value.trim() === '' ? null : value;
      });

      await updateWorkshop(workshop.id, {
        name: name.trim(),
        isActive: status === 'active',
        allowedProducts: Array.from(allowedProducts),
        allowedMaterials: Array.from(allowedMaterials),
        settings: settingsPayload,
      });
      toast({ title: 'Цех сохранён' });
      navigate('/crm/shifts/workshops');
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

  if (loading || !workshop) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Редактировать цех</h1>

        <Card className="border-border shadow-none">
          <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Название цеха</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'inactive')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активен</SelectItem>
                  <SelectItem value="inactive">Неактивен</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Смены в этом цехе</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {workshop.shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">В этом цехе пока нет открытых смен</p>
            ) : (
              workshop.shifts.map((s) => (
                <Badge key={s.number} variant="secondary" className="px-3 py-1.5 text-sm">
                  Смена № {s.number} — {s.employeesCount} сотр.
                </Badge>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Разрешённые товары маркетплейсов</CardTitle>
            <p className="text-sm text-muted-foreground">
              Отмеченные материалы будут доступны для взятия в работу в этом цехе (все ширины и высоты).
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {materials.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={allowedProducts.has(m.id)}
                  onCheckedChange={() => toggleSet(allowedProducts, m.id, setAllowedProducts)}
                />
                {m.name}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Разрешённые материалы</CardTitle>
            <p className="text-sm text-muted-foreground">
              Отмеченные материалы будут доступны для заказа и автозаказа в этом цехе.
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {Array.from(materialsByType.values())
              .flat()
              .map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox
                    checked={allowedMaterials.has(m.id)}
                    onCheckedChange={() => toggleSet(allowedMaterials, m.id, setAllowedMaterials)}
                  />
                  {m.name}
                </label>
              ))}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Настройки цеха</CardTitle>
            <p className="text-sm text-muted-foreground">
              Оставьте поле пустым — используется глобальное значение (указано справа). Заполните —
              значение переопределяется для этого цеха.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Параметр</TableHead>
                  <TableHead>Цеховое значение</TableHead>
                  <TableHead>Глобальное</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workshopSettingsConfig.map((item) => {
                  const field = workshop.settings[item.key];
                  const value = settingsValues[item.key] ?? '';
                  return (
                    <TableRow key={item.key}>
                      <TableCell className="whitespace-nowrap font-medium">{item.label}</TableCell>
                      <TableCell className="min-w-[220px]">
                        {item.type === 'select' ? (
                          <Select
                            value={value || 'none'}
                            onValueChange={(v) =>
                              setSettingsValues((s) => ({ ...s, [item.key]: v === 'none' ? '' : v }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="— Глобальное —" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">— Глобальное —</SelectItem>
                              {item.options?.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={item.type === 'number' ? 'number' : item.type === 'time' ? 'time' : 'text'}
                            value={value}
                            placeholder="—"
                            onChange={(e) =>
                              setSettingsValues((s) => ({ ...s, [item.key]: e.target.value }))
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {field?.global || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate('/crm/shifts/workshops')}>
            Отмена
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
          </Button>
        </div>
      </div>
    </CrmLayout>
  );
};

export default WorkshopEdit;
