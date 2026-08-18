import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import FabricCostCard from '@/components/crm/cost/FabricCostCard';
import CostSettingsPanel from '@/components/crm/cost/CostSettingsPanel';
import ExtraExpensesPanel from '@/components/crm/cost/ExtraExpensesPanel';
import { fetchProductCosts, type CostResponse, type CostGroup } from '@/lib/productCostApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Себестоимость товаров.
 *
 * Отвечает на вопрос, который иначе считают в тетрадке: во сколько нам обходится одна
 * вещь. Считаем по ТКАНИ и ШИРИНЕ — высота на себестоимость не влияет: полотно кроят
 * по ширине, тесьму пришивают по ширине, пакет берут по ширине. Поэтому вместо 875
 * карточек товара здесь 8 плашек по тканям с переключением ширин внутри.
 *
 * Цифры живые: цены берутся из прайсов поставщиков с их курсом валют, расход — из
 * карточки товара, оплата работ — из тарифов цеха. Подняли цену в прайсе —
 * себестоимость пересчиталась сама.
 */
const ProductCost = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  // Менеджер читает, но не правит: он торгуется с площадками и должен знать нижнюю
  // границу цены. А налог, тарифы и статьи расходов — деньги владельца.
  const canEdit = user?.role === 'admin';
  const [data, setData] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = () => {
    setLoading(true);
    fetchProductCosts()
      .then(setData)
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => data?.groups || [], [data]);

  // Собираем ширины под каждую ткань: одна плашка на ткань, внутри переключатель.
  const byFabric = useMemo(() => {
    const map = new Map<string, CostGroup[]>();
    groups.forEach((g) => {
      const key = g.material || '—';
      map.set(key, [...(map.get(key) || []), g]);
    });
    return [...map.entries()]
      .map(([material, widths]) => ({
        material,
        widths: [...widths].sort((a, b) => (a.width || 0) - (b.width || 0)),
      }))
      .sort((a, b) => a.material.localeCompare(b.material, 'ru'));
  }, [groups]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return byFabric;
    return byFabric.filter((f) => f.material.toLowerCase().includes(q));
  }, [byFabric, search]);

  const incompleteCount = groups.filter((g) => g.missing.length > 0).length;
  const complete = groups.filter((g) => g.missing.length === 0);
  const avg = complete.length
    ? complete.reduce((s, g) => s + g.total, 0) / complete.length
    : 0;
  const productsTotal = groups.reduce((s, g) => s + g.productsCount, 0);
  const extrasPerUnit = (data?.extras || [])
    .filter((e) => e.isActive)
    .reduce((s, e) => s + e.perUnit, 0);

  return (
    <CrmLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Себестоимость товаров</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Во сколько обходится одна вещь: материалы, работа цеха, налог. Считается по
              ткани и ширине — высота на себестоимость не влияет.
            </p>
          </div>
          {/* Следующий вопрос после «сколько стоит вещь» — «сколько мы на ней
              зарабатываем». Ведём туда прямо отсюда. */}
          <Button variant="outline" size="sm" asChild>
            <Link to="/crm/analytics/unit-economics">
              <Icon name="TrendingUp" size={14} className="mr-1.5" />
              Юнит-экономика маркетплейсов
            </Link>
          </Button>
        </div>

        {data && canEdit && (
          <CostSettingsPanel
            settings={data.settings}
            workshops={data.workshops}
            onSaved={load}
          />
        )}

        {data && canEdit && (
          <ExtraExpensesPanel expenses={data.extras} onChanged={load} />
        )}

        {/* Менеджеру те же параметры показываем справкой: он должен понимать,
            почему цифра именно такая, но менять её не может. */}
        {data && !canEdit && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Что входит в расчёт</p>
            <p className="mt-1 text-muted-foreground">
              Налог {data.settings.taxPercent}%
              {data.settings.marketplacePercent > 0 &&
                ` · комиссия площадки ${data.settings.marketplacePercent}%`}
              {extrasPerUnit > 0 &&
                ` · прочие расходы ${money(extrasPerUnit)} ₽ на вещь`}
            </p>
            {data.extras.filter((e) => e.isActive).length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {data.extras
                  .filter((e) => e.isActive)
                  .map((e) => `${e.name} — ${money(e.perUnit)} ₽`)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {!loading && groups.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Тканей</p>
              <p className="text-2xl font-bold">{byFabric.length}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Сочетаний</p>
              <p className="text-2xl font-bold">{groups.length}</p>
              <p className="text-xs text-muted-foreground">на {productsTotal} товаров</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Средняя себестоимость</p>
              <p className="text-2xl font-bold">{money(avg)} ₽</p>
            </div>
            <div
              className={`rounded-lg border p-3 ${
                incompleteCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-border'
              }`}
            >
              <p className="text-xs text-muted-foreground">Неполный расчёт</p>
              <p className="text-2xl font-bold">{incompleteCount}</p>
            </div>
          </div>
        )}

        <Input
          placeholder="Поиск по ткани"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Считаем себестоимость...
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Тканей не найдено</p>
        ) : (
          /* Плашка на каждую ткань, внутри — переключение по ширинам. */
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {visible.map((f) => (
              <FabricCostCard key={f.material} material={f.material} widths={f.widths} />
            ))}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ProductCost;