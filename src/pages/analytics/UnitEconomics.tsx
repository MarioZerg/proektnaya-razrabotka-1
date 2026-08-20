import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import MarketplaceTab from '@/components/crm/economics/MarketplaceTab';
import CompareTab from '@/components/crm/economics/CompareTab';
import {
  fetchEconomics,
  saveEconomicsSettings,
  type MarketplaceCode,
} from '@/lib/unitEconomicsApi';

/**
 * Юнит-экономика маркетплейсов.
 *
 * Себестоимость отвечает, во сколько вещь обходится нам. Здесь — что останется от
 * цены продажи после того, как площадка заберёт комиссию, логистику и эквайринг,
 * а часть покупателей откажется от заказа.
 *
 * По каждой площадке своя вкладка: комиссии, тарифы и процент выкупа у них разные,
 * и один и тот же товар на Ozon и на WB зарабатывает по-разному.
 */
const UnitEconomics = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canView = isAdmin || user?.role === 'manager';

  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState('ozon');
  const [showSettings, setShowSettings] = useState(false);
  const [tax, setTax] = useState('');
  const [vat, setVat] = useState('');
  const [fixedCosts, setFixedCosts] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t) setTab(t);
  }, [searchParams]);

  // Настройки общие для всех площадок — берём из любого расчёта.
  useEffect(() => {
    if (!canView) return;
    fetchEconomics({ marketplace: 'ozon', scheme: 'FBS' })
      .then((d) => {
        setTax(String(d.settings.taxPercent));
        setVat(String(d.settings.vatPercent ?? 0));
        setFixedCosts(String(d.settings.fixedCostsMonth));
      })
      .catch(() => undefined);
  }, [canView]);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await saveEconomicsSettings({
        taxPercent: Number(tax) || 0,
        vatPercent: Number(vat) || 0,
        fixedCostsMonth: Number(fixedCosts) || 0,
        actorId: user?.id,
      });
      toast({ title: 'Сохранено', description: 'Расчёт обновлён' });
      setShowSettings(false);
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

  if (!canView) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">
          Раздел доступен менеджеру и администратору.
        </p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Юнит-экономика маркетплейсов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Сколько остаётся с одной проданной вещи после комиссии, логистики,
              возвратов и налога. Считается по ткани, ширине и каждой высоте
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/crm/analytics/product-cost">
                <Icon name="Calculator" size={14} className="mr-1.5" />
                Себестоимость товаров
              </Link>
            </Button>
            {isAdmin && (
              <Button variant="ghost" size="sm" onClick={() => setShowSettings((v) => !v)}>
                <Icon name="Settings2" size={14} className="mr-1.5" />
                Налог и расходы
              </Button>
            )}
          </div>
        </div>

        {showSettings && isAdmin && (
          <Card className="border-border shadow-none">
            <CardContent className="space-y-3 pt-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Налог УСН, %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Платится со всей суммы, которую заплатил покупатель. Комиссия
                    площадки базу не уменьшает
                  </p>
                </div>
                {/* НДС задаётся отдельно: он уже сидит внутри цены на витрине,
                    поэтому не прибавляется к ней, а вынимается из неё. */}
                <div className="space-y-1.5">
                  <Label>НДС, %</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={vat}
                    onChange={(e) => setVat(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    0 — если освобождены. НДС входит в цену покупателя, а налог
                    УСН считается с суммы без него
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Постоянные расходы, ₽/мес</Label>
                  <Input
                    type="number"
                    step="1"
                    min={0}
                    value={fixedCosts}
                    onChange={(e) => setFixedCosts(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Аренда, оклады, связь — для расчёта точки безубыточности
                  </p>
                </div>
              </div>
              <Button onClick={handleSaveSettings} disabled={saving}>
                <Icon
                  name={saving ? 'Loader2' : 'Check'}
                  size={16}
                  className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
                />
                Сохранить
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setSearchParams(v === 'ozon' ? {} : { tab: v }, { replace: true });
          }}
        >
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            <TabsTrigger value="ozon">Ozon</TabsTrigger>
            <TabsTrigger value="wildberries">Wildberries</TabsTrigger>
            <TabsTrigger value="yandex_market">Яндекс Маркет</TabsTrigger>
            <TabsTrigger value="compare">Сравнение площадок</TabsTrigger>
          </TabsList>

          {(['ozon', 'wildberries', 'yandex_market'] as MarketplaceCode[]).map((code) => (
            <TabsContent key={code} value={code} className="mt-4">
              {/* Считаем только на открытой вкладке: каждый расчёт — это запрос
                  по всем товарам, и грузить три площадки сразу незачем. */}
              {tab === code && <MarketplaceTab code={code} />}
            </TabsContent>
          ))}

          <TabsContent value="compare" className="mt-4">
            {tab === 'compare' && <CompareTab />}
          </TabsContent>
        </Tabs>
      </div>
    </CrmLayout>
  );
};

export default UnitEconomics;