import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormSection } from '@/components/ui/form-section';
import type { WorkshopDetail } from '@/lib/workshopsApi';
import {
  workshopSettingsConfig,
  type SettingConfigItem,
} from '@/lib/workshopSettingsConfig';

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

interface WorkshopSettingsSectionProps {
  workshop: WorkshopDetail;
  settingsValues: Record<string, string>;
  setSettingsValues: Dispatch<SetStateAction<Record<string, string>>>;
}

/** Настройки цеха по группам: пустое поле берёт общее значение. */
const WorkshopSettingsSection = ({
  workshop,
  settingsValues,
  setSettingsValues,
}: WorkshopSettingsSectionProps) => (
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
);

export default WorkshopSettingsSection;
