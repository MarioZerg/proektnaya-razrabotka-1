import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { saveCostSettings, type CostSettings } from '@/lib/productCostApi';

interface CostSettingsPanelProps {
  settings: CostSettings;
  workshops: { id: number; name: string }[];
  onSaved: () => void;
}

/**
 * Параметры расчёта себестоимости.
 *
 * Всё остальное система знает сама: цены материалов приходят из прайсов поставщиков,
 * расход — из карточки товара, оплата работ — из тарифов цеха. А эти величины
 * вывести неоткуда, их задаёт владелец (прочие расходы — отдельным блоком ниже):
 *
 *  · налог — зависит от системы налогообложения;
 *  · комиссия площадки — своя у каждого маркетплейса;
 *  · цех — ставки закройщика и швеи в цехах разные, считать надо по какому-то одному.
 */
const CostSettingsPanel = ({ settings, workshops, onSaved }: CostSettingsPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [tax, setTax] = useState(String(settings.taxPercent));
  const [commission, setCommission] = useState(String(settings.marketplacePercent));
  const [workshopId, setWorkshopId] = useState(
    settings.workshopId ? String(settings.workshopId) : '',
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCostSettings({
        taxPercent: Number(tax) || 0,
        marketplacePercent: Number(commission) || 0,
        // Старое общее поле держим нулевым: расходы теперь ведутся списком статей.
        overheadPerItem: settings.overheadPerItem,
        workshopId: workshopId ? Number(workshopId) : null,
        actorId: user?.id,
      });
      toast({ title: 'Параметры сохранены', description: 'Себестоимость пересчитана' });
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

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Параметры расчёта</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Налог, %</Label>
            <Input
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="Например: 6"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Комиссия площадки, %</Label>
            <Input
              type="number"
              step="0.1"
              min={0}
              max={100}
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder="Например: 15"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Тарифы какого цеха</Label>
            <Select value={workshopId} onValueChange={setWorkshopId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите цех" />
              </SelectTrigger>
              <SelectContent>
                {workshops.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Цены материалов и тарифы работ система берёт сама — из прайсов поставщиков и
          настроек цеха. Меняется прайс — себестоимость пересчитывается без вашего участия.
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

export default CostSettingsPanel;
