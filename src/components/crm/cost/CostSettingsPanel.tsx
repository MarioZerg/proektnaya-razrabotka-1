import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
 * Цены материалов приходят из прайсов поставщиков, расход — из карточки товара,
 * оплата работ — из тарифов цеха. Задать нужно только одно: по тарифам какого
 * цеха считать, потому что ставки закройщика и швеи в цехах разные.
 *
 * Налога и комиссии площадки здесь больше нет: они зависят от цены продажи, а
 * не от затрат цеха, и настраиваются в юнит-экономике.
 */
const CostSettingsPanel = ({ settings, workshops, onSaved }: CostSettingsPanelProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [workshopId, setWorkshopId] = useState(
    settings.workshopId ? String(settings.workshopId) : '',
  );
  const [shortage, setShortage] = useState(
    String(settings.shortagePercent ?? 5),
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveCostSettings({
        // Старое общее поле держим нулевым: расходы теперь ведутся списком статей.
        overheadPerItem: settings.overheadPerItem,
        workshopId: workshopId ? Number(workshopId) : null,
        shortagePercent: Number(shortage) || 0,
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

          <div className="space-y-1.5">
            <Label>Недостачи материалов, %</Label>
            <Input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={shortage}
              onChange={(e) => setShortage(e.target.value)}
            />
            <p className="text-[11px] leading-snug text-muted-foreground">
              Обрезки, брак и пересорт ткани, тесьмы, пакетов и этикеток.
              Начисляется от стоимости материалов.
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Цены материалов и тарифы работ система берёт сама — из прайсов поставщиков и
          настроек цеха. Меняется прайс — себестоимость пересчитывается без вашего участия.
        </p>
        {/* Раньше налог и комиссия задавались здесь и накручивались на затраты.
            Это давало неверную цифру: оба расхода зависят от цены продажи. */}
        <p className="text-xs text-muted-foreground">
          Налог и комиссия площадки сюда не входят — они считаются от цены продажи
          и настраиваются в разделе «Юнит-экономика».
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