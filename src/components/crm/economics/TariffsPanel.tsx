import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  saveTariffs,
  type MarketplaceCode,
  type Tariffs,
} from '@/lib/unitEconomicsApi';

interface TariffsPanelProps {
  marketplaceCode: MarketplaceCode;
  tariffs: Tariffs;
  onSaved: () => void;
}

/**
 * Тарифы площадки.
 *
 * Комиссию и логистику по каждому товару система тянет из кабинета сама — они
 * зависят от категории и габаритов. А эти величины площадка через API не отдаёт
 * или отдаёт не полностью, поэтому их задаёт менеджер:
 *
 *  · хранение и приёмка — считаются по вашему обороту на складе площадки;
 *  · продвижение — сколько вы готовы тратить на рекламу с продажи;
 *  · обратная логистика — если площадка не отдала её по товару.
 */
const TariffsPanel = ({ marketplaceCode, tariffs, onSaved }: TariffsPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState(tariffs);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(tariffs), [tariffs]);

  const set = (key: keyof Tariffs, value: string) =>
    setForm((f) => ({ ...f, [key]: Number(value) || 0 }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveTariffs({ ...form, marketplaceCode, actorId: user?.id });
      toast({ title: 'Тарифы сохранены', description: 'Расчёт обновлён' });
      onSaved();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Поля, которые площадка заполняет сама. Названия приходят с сервера в том
  // виде, в каком лежат в базе, — сопоставляем их с полями формы.
  const syncedKeys = new Set(
    (tariffs.syncedFields || []).map((f) =>
      ({
        commission_fbo_percent: 'commissionFboPercent',
        commission_fbs_percent: 'commissionFbsPercent',
        logistics_fbo: 'logisticsFbo',
        logistics_fbs: 'logisticsFbs',
        return_logistics: 'returnLogistics',
        acquiring_percent: 'acquiringPercent',
      })[f] || f,
    ),
  );

  const syncedAt = tariffs.syncedAt
    ? new Date(tariffs.syncedAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  // Логистика и комиссия приходят от площадки по КАЖДОМУ размеру, поэтому
  // редактировать их нельзя: одно общее число на все размеры уже неверно, а
  // вручную вписанное перестанет отвечать тарифам площадки на следующий день.
  const readOnly = new Set<keyof Tariffs>([
    'logisticsFbo',
    'logisticsFbs',
    'commissionFbsPercent',
    'commissionFboPercent',
  ]);

  const fields: { key: keyof Tariffs; label: string; hint?: string }[] = [
    { key: 'commissionFbsPercent', label: 'Комиссия FBS, %' },
    { key: 'commissionFboPercent', label: 'Комиссия FBO, %' },
    { key: 'logisticsFbo', label: 'Логистика FBO, ₽', hint: 'в среднем по размерам' },
    { key: 'logisticsFbs', label: 'Логистика FBS, ₽', hint: 'в среднем по размерам' },
    { key: 'returnLogistics', label: 'Обратная логистика, ₽', hint: 'за каждый возврат' },
    { key: 'storagePerMonth', label: 'Хранение, ₽/мес', hint: 'за единицу на складе площадки' },
    { key: 'storageMonths', label: 'Срок хранения, мес', hint: 'сколько лежит до продажи' },
    { key: 'acceptanceFee', label: 'Приёмка поставки, ₽', hint: 'за единицу, только FBO' },
    { key: 'acquiringPercent', label: 'Эквайринг, %', hint: 'если не приходит суммой' },
    { key: 'promoPercent', label: 'Продвижение, %', hint: 'реклама от цены продажи' },
  ];

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          Тарифы площадки
          {syncedAt && (
            <span className="flex items-center gap-1 text-xs font-normal text-emerald-700">
              <Icon name="RefreshCw" size={12} />
              обновлено с площадки {syncedAt}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {fields.map((f) => {
            const locked = readOnly.has(f.key);
            const auto = locked || syncedKeys.has(f.key);
            return (
              <div key={f.key} className="space-y-1.5">
                <Label className="flex items-center gap-1 text-xs">
                  {f.label}
                  {/* Поле заполняет площадка: правка руками доживёт только до
                      следующей загрузки, и об этом честнее предупредить сразу. */}
                  {auto && (
                    <span
                      className="flex items-center gap-0.5 text-[10px] font-normal text-emerald-700"
                      title="Приходит из кабинета площадки автоматически"
                    >
                      <Icon name={locked ? 'Lock' : 'RefreshCw'} size={10} />
                      авто
                    </span>
                  )}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={String(form[f.key] ?? 0)}
                  onChange={(e) => set(f.key, e.target.value)}
                  readOnly={locked}
                  disabled={locked}
                  className={
                    auto ? 'border-emerald-200 bg-emerald-50/40' : undefined
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {locked
                    ? 'Считает площадка — по каждому размеру свой'
                    : auto
                      ? 'Обновляется автоматически'
                      : f.hint}
                </p>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Логистику и комиссию считает площадка — по каждому размеру отдельно,
          потому что тюль 200 см и штора 800 см едут за разные деньги. Здесь они
          показаны средними и не редактируются: в расчёт идёт точная цена
          конкретного размера. Обновляются раз в 6 часов вместе с ценами.
          Остальные расходы задаёте вы — площадка их не отдаёт, они зависят от
          вашего оборота и рекламного бюджета.
        </p>

        <Button onClick={handleSave} disabled={saving}>
          <Icon
            name={saving ? 'Loader2' : 'Check'}
            size={16}
            className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
          />
          Сохранить и пересчитать
        </Button>
      </CardContent>
    </Card>
  );
};

export default TariffsPanel;