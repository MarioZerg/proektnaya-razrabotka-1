import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchWorkshopDetail,
  isRetiredWorkshop,
  updateWorkshop,
  type WorkshopDetail,
} from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import WorkshopGeneralCard from '@/components/crm/workshopEdit/WorkshopGeneralCard';
import WorkshopMaterialsSections from '@/components/crm/workshopEdit/WorkshopMaterialsSections';
import WorkshopSettingsSection from '@/components/crm/workshopEdit/WorkshopSettingsSection';
import WorkshopSaveBar from '@/components/crm/workshopEdit/WorkshopSaveBar';

const WorkshopEdit = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [workshop, setWorkshop] = useState<WorkshopDetail | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [allowedProducts, setAllowedProducts] = useState<Set<number>>(new Set());
  const [allowedMaterials, setAllowedMaterials] = useState<Set<number>>(new Set());
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({});

  const load = () => {
    if (!id) return;
    setLoading(true);
    // Справочник материалов грузим отдельно: если связь моргнула и он не дошёл, карточка
    // цеха всё равно откроется. Раньше один сбой оставлял страницу пустой.
    fetchMaterialsData()
      .then((materialsData) => {
        setMaterials(materialsData.materials.filter((m) => m.status === 'active'));
        setMaterialTypes(materialsData.types);
      })
      .catch(() => {
        // FRONTEND-ONLY: материалы для галочек, не для самой карточки цеха.
      });
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchWorkshopDetail(Number(id))
      .then((w) => {
        setListError(null);
        setWorkshop(w);
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
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить цех');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggleSet = (set: Set<number>, value: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const materialsByType = useMemo(() => {
    return materialTypes
      .map((type) => ({
        type,
        items: materials.filter((m) => m.typeId === type.id),
      }))
      .filter((group) => group.items.length > 0);
  }, [materialTypes, materials]);

  const leftoverMaterials = useMemo(() => {
    const known = new Set(materialTypes.map((t) => t.id));
    return materials.filter((m) => !known.has(m.typeId));
  }, [materialTypes, materials]);

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

  if (id === '2' || (workshop && isRetiredWorkshop(workshop))) {
    return <Navigate to="/crm/shifts/workshops" replace />;
  }

  if (loading && !workshop) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  if (!workshop) {
    return (
      <CrmLayout>
        <WarehouseFetchError
          title="Не удалось загрузить цех"
          description={listError || undefined}
          onRetry={load}
        />
      </CrmLayout>
    );
  }

  const groupedMaterials = leftoverMaterials.length
    ? [...materialsByType, { type: { id: 0, name: 'Другие', sortOrder: 99 }, items: leftoverMaterials }]
    : materialsByType;

  return (
    <CrmLayout>
      <div className="space-y-4 pb-28 sm:space-y-6 sm:pb-0">
        <WorkshopGeneralCard
          workshop={workshop}
          name={name}
          setName={setName}
          status={status}
          setStatus={setStatus}
          onBack={() => navigate('/crm/shifts/workshops')}
        />

        <WorkshopMaterialsSections
          groupedMaterials={groupedMaterials}
          allowedProducts={allowedProducts}
          allowedMaterials={allowedMaterials}
          onToggleProduct={(mid) => toggleSet(allowedProducts, mid, setAllowedProducts)}
          onToggleMaterial={(mid) => toggleSet(allowedMaterials, mid, setAllowedMaterials)}
        />

        <WorkshopSettingsSection
          workshop={workshop}
          settingsValues={settingsValues}
          setSettingsValues={setSettingsValues}
        />

        <WorkshopSaveBar
          saving={saving}
          onCancel={() => navigate('/crm/shifts/workshops')}
          onSave={handleSave}
        />
      </div>
    </CrmLayout>
  );
};

export default WorkshopEdit;
