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

  const fields: { key: keyof Tariffs; label: string; hint?: string }[] = [
    { key: 'commissionFbsPercent', label: 'Комиссия FBS, %', hint: 'если не приходит по товару' },
    { key: 'commissionFboPercent', label: 'Комиссия FBO, %', hint: 'если не приходит по товару' },
    { key: 'logisticsFbo', label: 'Логистика FBO, ₽', hint: 'если площадка не отдала по товару' },
    { key: 'logisticsFbs', label: 'Логистика FBS, ₽', hint: 'если площадка не отдала по товару' },
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
        <CardTitle className="text-sm">Тарифы площадки</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={String(form[f.key] ?? 0)}
                onChange={(e) => set(f.key, e.target.value)}
              />
              {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          Комиссию и логистику по каждому товару система берёт из кабинета площадки —
          они зависят от категории и габаритов. Здесь задаются только те расходы,
          которые площадка через API не отдаёт.
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
