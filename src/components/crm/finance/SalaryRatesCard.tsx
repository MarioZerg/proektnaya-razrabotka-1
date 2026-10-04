import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchSalaryRates, type SalaryRate } from '@/lib/salaryApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { roleRateLabels } from '@/components/crm/finance/financeShared';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

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

/** packer_repack — не должность, а вид оплаты упаковщицы; в списке сразу после её ставки. */
const ROLE_ORDER: string[] = [
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

const pluralRates = (n: number) => (n === 1 ? 'ставка' : n < 5 ? 'ставки' : 'ставок');

/** Только строки, по которым реально считается оплата (нули и мёртвые ширины скрыты). */
const ratesForRole = (rates: SalaryRate[], role: string): SalaryRate[] =>
  rates.filter((r) => {
    if (r.role !== role) return false;
    if (role === 'cutter') return r.width === null;
    if (role === 'packer') return r.materialId === null && r.width === null;
    if (role === 'packer_repack') return r.width === null;
    if (role.includes('overlock')) return r.materialId === null && r.width === null;
    return true;
  });

const roleTitle = (role: string) =>
  roleLabels[role as Role] || rateGroupTitles[role] || role;

const SalaryRatesCard = ({ onUpdate }: SalaryRatesCardProps) => {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [workshopsLoading, setWorkshopsLoading] = useState(true);
  const [workshopsError, setWorkshopsError] = useState<string | null>(null);
  const [activeWorkshopId, setActiveWorkshopId] = useState<string>('');

  const [rates, setRates] = useState<SalaryRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [openRoles, setOpenRoles] = useState<Set<string>>(() => new Set());

  const roleFolders = useMemo(
    () =>
      ROLE_ORDER.map((role) => {
        const roleRates = ratesForRole(rates, role);
        if (roleRates.length === 0) return null;
        return { role, rates: roleRates, title: roleTitle(role) };
      }).filter((x): x is NonNullable<typeof x> => x != null),
    [rates],
  );

  const loadWorkshops = () => {
    setWorkshopsLoading(true);
    fetchWorkshops()
      .then((data) => {
        setWorkshopsError(null);
        const active = data.filter((w) => w.isActive);
        setWorkshops(active);
        if (active.length > 0) setActiveWorkshopId(String(active[0].id));
      })
      .catch((e) => {
        setWorkshopsError(e instanceof Error ? e.message : 'Не удалось загрузить цеха');
      })
      .finally(() => setWorkshopsLoading(false));
  };

  useEffect(() => {
    loadWorkshops();
  }, []);

  const loadRates = () => {
    if (!activeWorkshopId) return;
    setRatesLoading(true);
    fetchSalaryRates(Number(activeWorkshopId))
      .then((list) => {
        setRatesError(null);
        setRates(list);
      })
      .catch((e) => {
        setRatesError(e instanceof Error ? e.message : 'Не удалось загрузить тарифы');
      })
      .finally(() => setRatesLoading(false));
  };

  useEffect(() => {
    loadRates();
    setOpenRoles(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkshopId]);

  const handleUpdate = async (id: number, rate: number) => {
    await onUpdate(id, rate);
    loadRates();
  };

  const toggleRole = (role: string) => {
    setOpenRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Тарифы по ролям</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {workshopsError ? (
          <WarehouseFetchError
            title="Не удалось загрузить цеха"
            description={workshopsError}
            onRetry={loadWorkshops}
          />
        ) : workshopsLoading && workshops.length === 0 ? (
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

            {ratesError && (
              <WarehouseFetchError
                title="Не удалось загрузить тарифы"
                description={ratesError}
                onRetry={loadRates}
              />
            )}

            {ratesLoading && rates.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loader2" size={16} className="animate-spin" />
                Загрузка тарифов...
              </div>
            ) : roleFolders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Тарифов в этом цехе пока нет</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="divide-y divide-border">
                  {roleFolders.map(({ role, rates: roleRates, title }) => {
                    const open = openRoles.has(role);
                    return (
                      <div key={role} className="bg-card">
                        <button
                          type="button"
                          onClick={() => toggleRole(role)}
                          className="flex w-full min-w-0 items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/50"
                        >
                          <Icon
                            name="Folder"
                            size={14}
                            className={`shrink-0 transition-colors ${
                              open ? 'text-amber-600' : 'text-muted-foreground'
                            }`}
                          />
                          <Icon
                            name="ChevronRight"
                            size={14}
                            className={`shrink-0 text-muted-foreground transition-transform ${
                              open ? 'rotate-90' : ''
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{title}</p>
                            <p className="text-xs text-muted-foreground">
                              {roleRateLabels[role] || `${roleRates.length} ${pluralRates(roleRates.length)}`}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {roleRates.length} {pluralRates(roleRates.length)}
                          </span>
                        </button>

                        {open && (
                          <div className="border-t border-border bg-background px-3 py-3">
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              {roleRates.map((rate) => (
                                <RateRow key={rate.id} rate={rate} onUpdate={handleUpdate} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default SalaryRatesCard;
