import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import ProductCostCard from '@/components/crm/cost/ProductCostCard';
import CostSettingsPanel from '@/components/crm/cost/CostSettingsPanel';
import { fetchProductCosts, type CostResponse } from '@/lib/productCostApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Себестоимость товаров.
 *
 * Отвечает на вопрос, который иначе считают в тетрадке: во сколько нам обходится одна
 * вещь. Каждый товар — плашка с разбором: ткань, фурнитура, упаковка, оплата раскроя,
 * пошива и стикеровки, прочие расходы, налог.
 *
 * Цифры живые: цены берутся из прайсов поставщиков с их курсом валют, расход — из
 * карточки товара, оплата работ — из тарифов цеха. Подняли цену в прайсе — себестоимость
 * пересчиталась сама, ничего вручную вводить не нужно.
 */
const ProductCost = () => {
  const { toast } = useToast();
  const [data, setData] = useState<CostResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [visible, setVisible] = useState(24);

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

  const items = useMemo(() => data?.items || [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (onlyIncomplete && i.missing.length === 0) return false;
      if (!q) return true;
      return (
        i.name?.toLowerCase().includes(q) || i.material?.toLowerCase().includes(q)
      );
    });
  }, [items, search, onlyIncomplete]);

  // Сброс постраничной догрузки при смене отбора.
  useEffect(() => {
    setVisible(24);
  }, [search, onlyIncomplete]);

  const incompleteCount = items.filter((i) => i.missing.length > 0).length;
  // Средняя себестоимость считается по товарам с полными данными: неполные
  // занизили бы её и создали ложное впечатление дешевизны.
  const complete = items.filter((i) => i.missing.length === 0);
  const avg = complete.length
    ? complete.reduce((s, i) => s + i.total, 0) / complete.length
    : 0;

  return (
    <CrmLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold">Себестоимость товаров</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Во сколько обходится одна вещь: материалы, работа цеха, налог. Цены берутся
            из прайсов поставщиков и обновляются сами.
          </p>
        </div>

        {data && (
          <CostSettingsPanel
            settings={data.settings}
            workshops={data.workshops}
            onSaved={load}
          />
        )}

        {!loading && items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Товаров в расчёте</p>
              <p className="text-2xl font-bold">{items.length}</p>
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

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск по товару или ткани"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Button
            variant={onlyIncomplete ? 'default' : 'outline'}
            onClick={() => setOnlyIncomplete((v) => !v)}
          >
            <Icon name="TriangleAlert" size={16} className="mr-1.5" />
            Только неполные
            {incompleteCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {incompleteCount}
              </Badge>
            )}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Считаем себестоимость...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Товаров не найдено</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Показано {Math.min(visible, filtered.length)} из {filtered.length}
            </p>
            {/* Плашками: каждый товар — отдельная карточка с разбором расходов. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.slice(0, visible).map((i) => (
                <ProductCostCard key={i.id} item={i} />
              ))}
            </div>
            {filtered.length > visible && (
              <div className="flex justify-center py-2">
                <Button variant="outline" onClick={() => setVisible((n) => n + 24)}>
                  Показать ещё
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default ProductCost;