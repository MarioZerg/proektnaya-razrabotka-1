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

/**
 * Названия групп для видов оплаты, которым не соответствует должность в системе.
 *
 * Перепаковку возвратов и этап оверлока выполняют те же упаковщицы и швеи, поэтому
 * отдельных ролей у них нет — а заголовок в таблице тарифов нужен.
 */
const rateGroupTitles: Record<string, string> = {
  packer_repack: 'Упаковщик — перепаковка',
  overlock: 'Оверлок',
  sewer_overlock: 'Швея — после оверлока',
  packer_overlock: 'Упаковщик — после оверлока',
};

const SalaryRatesCard = ({ onUpdate }: SalaryRatesCardProps) => {
  // packer_repack — не должность, а отдельный вид оплаты упаковщицы (перепаковка
  // возвратов за штуку), поэтому в списке ролей идёт сразу после её основной ставки.
  const roleOrder: string[] = [
    'cutter',
    'sewer',
    'sewer_overlock',
    'overlock',
    'packer',
    'packer_overlock',
    'packer_repack',
    'storekeeper',
    'senior_storekeeper',
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
                // Показываем ровно те строки, по которым реально считается оплата:
                //  - закройщик: одна ставка на ткань (строки по ширинам обнулены);
                //  - упаковщик и перепаковка: одна ставка на цех (без ткани и ширины).
                // Остальное осталось в базе с нулями и в расчёте не участвует — в списке
                // это была бы простыня из десятков полей, которые ни на что не влияют.
                const roleRates = rates.filter((r) => {
                  if (r.role !== role) return false;
                  if (role === 'cutter') return r.width === null;
                  if (role === 'packer') return r.materialId === null && r.width === null;
                  if (role === 'packer_repack') return r.width === null;
                  // Этап оверлока: одна ставка на цех, без ткани и ширины.
                  if (role.includes('overlock')) return r.materialId === null && r.width === null;
                  return true;
                });
                if (roleRates.length === 0) return null;

                return (
                  <div key={role} className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold">
                        {/* Виды оплаты, у которых нет одноимённой должности
                            (перепаковка возвратов, этап оверлока), берут название
                            из подписи тарифа: в справочнике ролей их нет. */}
                        {roleLabels[role as Role] || rateGroupTitles[role] || role}
                      </p>
                      <p className="text-xs text-muted-foreground">{roleRateLabels[role]}</p>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {roleRates.map((rate) => (
                        <RateRow key={rate.id} rate={rate} onUpdate={handleUpdate} />
                      ))}
                    </div>
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