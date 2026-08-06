import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchSalaryRates, type SalaryRate } from '@/lib/salaryApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { roleRateLabels } from '@/components/crm/finance/financeShared';

interface SalaryRatesCardProps {
  onUpdate: (id: number, rate: number) => Promise<void>;
}

const RateRow = ({
  rate,
  onUpdate,
  hideMaterialName = false,
}: {
  rate: SalaryRate;
  onUpdate: (id: number, rate: number) => Promise<void>;
  /** Внутри группы, уже подписанной названием материала (закройщик), название материала
   * в самой строке не дублируем — показываем только ширину. */
  hideMaterialName?: boolean;
}) => {
  const [value, setValue] = useState(String(rate.rate));
  const [saving, setSaving] = useState(false);
  const dirty = value !== String(rate.rate);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(rate.id, Number(value));
    } finally {
      setSaving(false);
    }
  };

  const materialPart = hideMaterialName ? null : rate.materialName;
  const label = materialPart
    ? rate.width
      ? `${materialPart} ${rate.width} см`
      : materialPart
    : rate.width
      ? `${rate.width} см`
      : null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
      <span className="text-sm">{label || '—'}</span>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-24"
        />
        <span className="text-xs text-muted-foreground">₽</span>
        {dirty && (
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleSave} disabled={saving}>
            {saving ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="Check" size={14} />}
          </Button>
        )}
      </div>
    </div>
  );
};

const SalaryRatesCard = ({ onUpdate }: SalaryRatesCardProps) => {
  // packer_repack — не должность, а отдельный вид оплаты упаковщицы (перепаковка
  // возвратов за штуку), поэтому в списке ролей идёт сразу после её основной ставки.
  const roleOrder: string[] = [
    'cutter',
    'sewer',
    'packer',
    'packer_repack',
    'storekeeper',
    'cleaner',
    'admin',
  ];

  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopsLoading, setWorkshopsLoading] = useState(true);
  const [activeWorkshopId, setActiveWorkshopId] = useState<string>('');

  const [rates, setRates] = useState<SalaryRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);

  useEffect(() => {
    fetchWorkshops()
      .then((data) => {
        const active = data.filter((w) => w.isActive);
        setWorkshops(active);
        if (active.length > 0) setActiveWorkshopId(String(active[0].id));
      })
      .finally(() => setWorkshopsLoading(false));
  }, []);

  const loadRates = () => {
    if (!activeWorkshopId) return;
    setRatesLoading(true);
    fetchSalaryRates(Number(activeWorkshopId))
      .then(setRates)
      .finally(() => setRatesLoading(false));
  };

  useEffect(() => {
    loadRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkshopId]);

  const handleUpdate = async (id: number, rate: number) => {
    await onUpdate(id, rate);
    loadRates();
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Тарифы по ролям</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {workshopsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : workshops.length === 0 ? (
          <p className="text-sm text-muted-foreground">Цехов пока нет — сначала создайте цех</p>
        ) : (
          <>
            <Tabs value={activeWorkshopId} onValueChange={setActiveWorkshopId}>
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                {workshops.map((w) => (
                  <TabsTrigger key={w.id} value={String(w.id)} className="shrink-0">
                    {w.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {ratesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loader2" size={16} className="animate-spin" />
                Загрузка тарифов...
              </div>
            ) : (
              roleOrder.map((role) => {
                const roleRates = rates.filter((r) => r.role === role);
                if (roleRates.length === 0) return null;

                // У закройщика много строк (материал × ширина) — группируем по материалу
                // с подзаголовком, иначе список выглядел бы нечитаемой простынёй.
                const groupedByMaterial = role === 'cutter';
                const materialGroups = groupedByMaterial
                  ? Array.from(new Set(roleRates.map((r) => r.materialName || '—'))).map((materialName) => ({
                      materialName,
                      items: roleRates.filter((r) => (r.materialName || '—') === materialName),
                    }))
                  : null;

                return (
                  <div key={role} className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {roleLabels[role as Role] || 'Упаковщик — перепаковка'}
                      </p>
                      <p className="text-xs text-muted-foreground">{roleRateLabels[role]}</p>
                    </div>
                    {materialGroups ? (
                      <div className="space-y-3">
                        {materialGroups.map((group) => (
                          <div key={group.materialName} className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">{group.materialName}</p>
                            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                              {group.items.map((rate) => (
                                <RateRow key={rate.id} rate={rate} onUpdate={handleUpdate} hideMaterialName />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {roleRates.map((rate) => (
                          <RateRow key={rate.id} rate={rate} onUpdate={handleUpdate} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SalaryRatesCard;