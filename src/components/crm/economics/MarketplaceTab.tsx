import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchEconomics,
  syncPrices,
  MARKETPLACE_LABELS,
  type EconomicsResponse,
  type MarketplaceCode,
  type Scheme,
} from '@/lib/unitEconomicsApi';
import EconomicsRowCard from './EconomicsRowCard';
import TariffsPanel from './TariffsPanel';
import MonthlySizesReport from './MonthlySizesReport';
import PlatformFeesPanel from './PlatformFeesPanel';
import StorageByItemPanel from './StorageByItemPanel';
import { moneyShort } from './economicsShared';

/**
 * Вкладка одной площадки.
 *
 * Переключатель FBO/FBS вверху: у схем разная комиссия и логистика, и товар,
 * прибыльный на своём складе, может уходить в минус на складе площадки.
 */
const MarketplaceTab = ({ code }: { code: MarketplaceCode }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [scheme, setScheme] = useState<Scheme>('FBS');
  const [data, setData] = useState<EconomicsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [search, setSearch] = useState('');
  // Свой процент выкупа — сценарий «а если выкуп упадёт до 70%».
  const [buyoutOverride, setBuyoutOverride] = useState('');
  const [showTariffs, setShowTariffs] = useState(false);
  // Отчёт по месяцам грузим только по требованию: он ходит за отдельными
  // данными, а нужен не при каждом открытии экономики.
  const [showMonthly, setShowMonthly] = useState(false);
  // Удержания площадки сверх комиссии: подписки, слоты, штрафы.
  const [showFees, setShowFees] = useState(false);
  // Хранение в разрезе товаров: видно, какие позиции залежались.
  const [showStorage, setShowStorage] = useState(false);

  const load = () => {
    setLoading(true);
    fetchEconomics({
      withCompare: true,
      marketplace: code,
      scheme,
      buyout: buyoutOverride ? Number(buyoutOverride) : undefined,
    })
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

  useEffect(load, [code, scheme, buyoutOverride]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(0);
    try {
      const total = await syncPrices(code, user?.id, setSyncProgress);
      toast({
        title: 'Цены обновлены',
        description: `Загружено ${total} карточек из кабинета`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось обновить цены',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const rows = useMemo(() => data?.rows || [], [data]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.material || '').toLowerCase().includes(q));
  }, [rows, search]);

  // Сводка: сколько позиций считается и где мы теряем деньги.
  const priced = rows.filter((r) => r.unit);
  const lossmaking = priced.filter((r) => r.unit!.profit < 0);
  const avgMargin = priced.length
    ? Math.round((priced.reduce((s, r) => s + r.unit!.margin, 0) / priced.length) * 10) / 10
    : 0;
  const avgProfit = priced.length
    ? priced.reduce((s, r) => s + r.unit!.profit, 0) / priced.length
    : 0;

  // Самая прибыльная позиция — вместо точки безубыточности.
  //
  // Раньше здесь считалось, сколько вещей продать, чтобы покрыть аренду и
  // оклады. Но эти расходы уже разложены на каждую вещь в себестоимости:
  // прибыль с вещи их УЖЕ покрывает, и делить на них ещё раз было двойным
  // счётом. Показываем то, что действительно помогает решать, — где заработок
  // выше всего.
  const best = priced.reduce<typeof priced[number] | null>(
    (acc, r) => (!acc || r.unit!.profit > acc.unit!.profit ? r : acc),
    null,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scheme} onValueChange={(v) => setScheme(v as Scheme)}>
          <TabsList>
            <TabsTrigger value="FBS">FBS — со своего склада</TabsTrigger>
            <TabsTrigger value="FBO">FBO — со склада площадки</TabsTrigger>
          </TabsList>
        </Tabs>

        {canEdit && (
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <Icon
              name={syncing ? 'Loader2' : 'RefreshCw'}
              size={16}
              className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
            />
            {syncing
              ? `Загружаем… ${syncProgress}`
              : `Обновить цены из ${MARKETPLACE_LABELS[code]}`}
          </Button>
        )}
      </div>

      {/* Сводка по площадке. */}
      {!loading && data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Позиций с ценой</p>
            <p className="text-2xl font-bold">{priced.length}</p>
            <p className="text-xs text-muted-foreground">из {rows.length} сочетаний</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Средняя прибыль</p>
            <p className="text-2xl font-bold">{moneyShort(avgProfit)} ₽</p>
            <p className="text-xs text-muted-foreground">с одной вещи</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Средняя маржа</p>
            <p className="text-2xl font-bold">{avgMargin}%</p>
          </div>
          <div
            className={`rounded-lg border p-3 ${
              lossmaking.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'border-border'
            }`}
          >
            <p className="text-xs text-muted-foreground">Убыточных позиций</p>
            <p className="text-2xl font-bold">{lossmaking.length}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Лучшая позиция</p>
            <p className="text-2xl font-bold">
              {best ? `${moneyShort(best.unit!.profit)} ₽` : '—'}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {best ? `${best.material} · ${best.width} см` : 'нет данных'}
            </p>
          </div>
        </div>
      )}

      {/* Процент выкупа — параметр, который сильнее всего двигает прибыль. */}
      {data && (
        <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-muted/30 p-3">
          <div>
            <p className="text-xs text-muted-foreground">Процент выкупа в расчёте</p>
            <p className="text-lg font-bold">
              {data.buyout.used}%
              {data.buyout.isOverride && (
                <Badge variant="secondary" className="ml-2 text-xs">
                  задан вручную
                </Badge>
              )}
            </p>
            {/* Данные площадки честнее наших: они видят возвраты уже после
                доставки, а мы — только отмены до отгрузки. Разрыв доходит до
                20 пунктов, поэтому показываем оба числа рядом. */}
            {data.buyout.fromMarketplace != null && (
              <p className="text-xs text-emerald-700">
                <Icon name="RefreshCw" size={11} className="mr-0.5 inline" />
                По данным площадки: {data.buyout.fromMarketplace}% (продано{' '}
                {data.buyout.mpOrdered}, вернули {data.buyout.mpReturned})
              </p>
            )}
            {data.buyout.real != null && (
              <p className="text-xs text-muted-foreground">
                По нашим отметкам: {data.buyout.real}% — только отмены до отгрузки
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Свой процент для сценария</Label>
            <div className="flex gap-1.5">
              <Input
                type="number"
                min={1}
                max={100}
                value={buyoutOverride}
                onChange={(e) => setBuyoutOverride(e.target.value)}
                placeholder={String(data.buyout.real ?? 100)}
                className="w-28"
              />
              {buyoutOverride && (
                <Button variant="ghost" size="icon" onClick={() => setBuyoutOverride('')}>
                  <Icon name="X" size={16} />
                </Button>
              )}
            </div>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            Логистику мы платим за каждую отправленную вещь, а деньги получаем только
            за выкупленные. Поэтому чем ниже выкуп, тем дороже обходится каждая продажа
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Поиск по ткани"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setShowTariffs((v) => !v)}>
            <Icon name="Settings2" size={14} className="mr-1.5" />
            {showTariffs ? 'Скрыть' : 'Настроить'} тарифы площадки
          </Button>
        )}
        {/* Динамика по месяцам: падение спроса по размеру видно только в
            сравнении месяцев, в разрезе «за 30 дней» его не разглядеть. */}
        <Button variant="ghost" size="sm" onClick={() => setShowMonthly((v) => !v)}>
          <Icon name="TrendingUp" size={14} className="mr-1.5" />
          {showMonthly ? 'Скрыть' : 'Показать'} динамику по месяцам
        </Button>
        {/* Расходы, которых нет в стоимости товара: они относятся к магазину
            и месяцу, а не к вещи. Смотреть их надо отдельно. */}
        <Button variant="ghost" size="sm" onClick={() => setShowFees((v) => !v)}>
          <Icon name="ReceiptText" size={14} className="mr-1.5" />
          {showFees ? 'Скрыть' : 'Показать'} расходы площадки
        </Button>
        {/* Хранение по товарам: общая сумма ничего не говорит о том, какие
            позиции залежались, — а это и есть повод для решения. */}
        <Button variant="ghost" size="sm" onClick={() => setShowStorage((v) => !v)}>
          <Icon name="Warehouse" size={14} className="mr-1.5" />
          {showStorage ? 'Скрыть' : 'Показать'} хранение по товарам
        </Button>
      </div>

      {showMonthly && <MonthlySizesReport marketplace={code} />}
      {showFees && <PlatformFeesPanel marketplace={code} />}
      {showStorage && <StorageByItemPanel marketplace={code} />}

      {showTariffs && data && canEdit && (
        <TariffsPanel marketplaceCode={code} tariffs={data.tariffs} onSaved={load} />
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Считаем экономику…
        </div>
      ) : priced.length === 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-bold text-amber-900">Нет цен с площадки</p>
          <p className="mt-1 text-sm text-amber-900">
            Нажмите «Обновить цены» — система заберёт актуальные цены и комиссии из
            кабинета {MARKETPLACE_LABELS[code]}. Без цен посчитать прибыль нельзя
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {visible.map((r) => (
            <EconomicsRowCard
              key={`${r.material}-${r.width}`}
              row={r}
              scheme={scheme}
              altScheme={data?.altScheme}
            />
          ))}
        </div>
      )}

      {data && priced.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Расчёт от суммы, которую платит покупатель · налог УСН
          {' '}{data.settings.taxPercent}%
          {/* Про НДС говорим отдельно: его считают не от цены, а вынимают
              из неё, и без пояснения цифра выглядит неверной. */}
          {data.settings.vatPercent > 0 && (
            <>
              {' '}· НДС {data.settings.vatPercent}% <b>внутри</b> цены, не сверху:
              из {100 + data.settings.vatPercent} ₽ цены налог —
              {' '}{data.settings.vatPercent} ₽
            </>
          )}
          {' '}· комиссия и логистика — из кабинета {MARKETPLACE_LABELS[code]} ·
          себестоимость — из раздела «Себестоимость товаров»
        </p>
      )}
    </div>
  );
};

export default MarketplaceTab;