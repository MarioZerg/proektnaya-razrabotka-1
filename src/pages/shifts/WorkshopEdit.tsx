import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSection } from '@/components/ui/form-section';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchWorkshopDetail,
  isRetiredWorkshop,
  updateWorkshop,
  type WorkshopDetail,
} from '@/lib/workshopsApi';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import {
  workshopSettingsConfig,
  type SettingConfigItem,
} from '@/lib/workshopSettingsConfig';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const SETTING_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'Рабочий день',
    keys: [
      'working_day_start',
      'working_day_end',
      'is_enabled_work_schedule',
      'floating_schedule',
    ],
  },
  {
    title: 'Очередь заказов',
    keys: [
      'orders_priority',
      'orders_filter',
      'orders_cluster_priority',
      'ozon_cutoff_enabled',
      'ozon_cutoff_time',
    ],
  },
  {
    title: 'Лимиты',
    keys: [
      'max_quantity_orders_to_seamstress',
      'max_quantity_orders_to_cutter',
      'cutter_daily_limit',
      'max_fabric_rolls_per_shift',
    ],
  },
  {
    title: 'Штрафы',
    keys: [
      'late_opened_shift_penalty',
      'unclosed_shift_penalty',
      'unclosed_shift_with_orders_penalty',
      'cancel_order_penalty',
    ],
  },
  {
    title: 'Пошив',
    keys: [
      'timeout_200',
      'timeout_300',
      'timeout_400',
      'timeout_500',
      'timeout_600',
      'timeout_700',
      'timeout_800',
      'sewing_stagger_minutes',
    ],
  },
  {
    // Оверлок отдельной группой: в цехе он один, и правила у него свои — не как
    // у прямострочки, где машин много и работать может вся смена.
    title: 'Оверлок',
    keys: [
      'max_overlock_orders_to_seamstress',
      'overlock_timeout_200',
      'overlock_timeout_300',
      'overlock_timeout_400',
      'overlock_timeout_500',
      'overlock_timeout_600',
      'overlock_timeout_700',
      'overlock_timeout_800',
      'overlock_stagger_minutes',
    ],
  },
  {
    title: 'Терминал',
    keys: [
      'print_qr_cutting',
      'sticking_otk',
      'sticking_seamstress',
      'manual_stickering',
      'sewer_packing_after_packer_shift',
    ],
  },
];

const byKey = new Map(workshopSettingsConfig.map((item) => [item.key, item]));

const formatGlobal = (item: SettingConfigItem, raw: string | null | undefined) => {
  if (!raw) return 'не задано';
  if (item.type === 'select') {
    return item.options?.find((opt) => opt.value === raw)?.label ?? raw;
  }
  return raw;
};

const SettingControl = ({
  item,
  value,
  onChange,
}: {
  item: SettingConfigItem;
  value: string;
  onChange: (next: string) => void;
}) => {
  if (item.type === 'select') {
    return (
      <Select
        value={value || 'none'}
        onValueChange={(v) => onChange(v === 'none' ? '' : v)}
      >
        <SelectTrigger className="h-11 text-base md:h-10 md:text-sm">
          <SelectValue placeholder="Как в общих настройках" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Как в общих настройках</SelectItem>
          {item.options?.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type={item.type === 'number' ? 'number' : item.type === 'time' ? 'time' : 'text'}
      inputMode={item.type === 'number' ? 'decimal' : undefined}
      value={value}
      placeholder="Как в общих"
      className="h-11 md:h-10"
      onChange={(e) => onChange(e.target.value)}
    />
  );
};

const MaterialChecks = ({
  items,
  selected,
  onToggle,
}: {
  items: Material[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) => (
  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
    {items.map((m) => {
      const on = selected.has(m.id);
      return (
        <button
          key={m.id}
          type="button"
          aria-pressed={on}
          onClick={() => onToggle(m.id)}
          className={cn(
            'flex min-h-9 items-start gap-1.5 rounded-md border px-2 py-1.5 text-left text-sm leading-tight',
            on
              ? 'border-emerald-600 bg-emerald-50'
              : 'border-border bg-background',
          )}
        >
          <span
            className={cn(
              'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
              on
                ? 'border-emerald-700 bg-emerald-700'
                : 'border-muted-foreground/50 bg-background',
            )}
          >
            {on && (
              <Icon name="Check" size={10} strokeWidth={3} className="text-white" />
            )}
          </span>
          <span className="min-w-0 break-words">{m.name}</span>
        </button>
      );
    })}
  </div>
);

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
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
            onClick={() => navigate('/crm/shifts/workshops')}
            aria-label="К списку цехов"
          >
            <Icon name="ArrowLeft" size={20} />
          </Button>
          <h1 className="min-w-0 truncate text-xl font-bold">{workshop.name}</h1>
        </div>

        <Card className="border-border shadow-none">
          <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Название цеха</Label>
              <Input
                value={name}
                className="h-11 md:h-10"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'inactive')}>
                <SelectTrigger className="h-11 text-base md:h-10 md:text-sm">
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

        {workshop.shifts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {workshop.shifts.map((s) => (
              <Badge key={s.number} variant="secondary" className="px-2 py-1 text-sm">
                Смена № {s.number} — {s.employeesCount} сотр.
              </Badge>
            ))}
          </div>
        )}

        <FormSection
          title="Товары маркетплейсов"
          hint={`Отмечено ${allowedProducts.size}`}
        >
          <p className="-mt-1 text-sm text-muted-foreground">
            Какие ткани этот цех берёт в работу — все ширины и высоты.
          </p>
          {groupedMaterials.map((group) => (
            <div key={group.type.id} className="pt-1">
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.type.name}
              </p>
              <MaterialChecks
                items={group.items}
                selected={allowedProducts}
                onToggle={(mid) => toggleSet(allowedProducts, mid, setAllowedProducts)}
              />
            </div>
          ))}
        </FormSection>

        <FormSection
          title="Материалы для заявок"
          hint={`Отмечено ${allowedMaterials.size}`}
        >
          <p className="-mt-1 text-sm text-muted-foreground">
            Что цех может заказывать со склада и что попадёт в автозаказ.
          </p>
          {groupedMaterials.map((group) => (
            <div key={group.type.id} className="pt-1">
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.type.name}
              </p>
              <MaterialChecks
                items={group.items}
                selected={allowedMaterials}
                onToggle={(mid) => toggleSet(allowedMaterials, mid, setAllowedMaterials)}
              />
            </div>
          ))}
        </FormSection>

        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold">Настройки цеха</h2>
            <p className="text-sm text-muted-foreground">
              Пустое поле берёт общее значение. Заполните — будет действовать только здесь.
            </p>
          </div>

          {SETTING_GROUPS.map((group) => (
            <FormSection key={group.title} title={group.title}>
              {group.keys.map((key) => {
                const item = byKey.get(key);
                if (!item) return null;
                const field = workshop.settings[item.key];
                const value = settingsValues[item.key] ?? '';
                return (
                  <div key={item.key} className="space-y-1.5">
                    <Label className="leading-snug">{item.label}</Label>
                    <SettingControl
                      item={item}
                      value={value}
                      onChange={(next) =>
                        setSettingsValues((s) => ({ ...s, [item.key]: next }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Общее: {formatGlobal(item, field?.global)}
                    </p>
                  </div>
                );
              })}
            </FormSection>
          ))}
        </div>

        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-3 py-3 pr-20 backdrop-blur sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:pr-0 sm:backdrop-blur-none"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex gap-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 sm:h-10 sm:flex-none"
              onClick={() => navigate('/crm/shifts/workshops')}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-11 flex-1 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-10 sm:flex-none"
            >
              {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>
    </CrmLayout>
  );
};

export default WorkshopEdit;