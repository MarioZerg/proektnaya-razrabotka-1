import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { fetchBoughtFeed, refreshSales } from '@/lib/managerFinanceApi';
import { useToast } from '@/hooks/use-toast';
import RevenueBreakdown from '@/components/crm/finance/RevenueBreakdown';
import BuyoutsHeader from '@/components/crm/buyouts/BuyoutsHeader';
import BuyoutsFilters from '@/components/crm/buyouts/BuyoutsFilters';
import BuyoutsList from '@/components/crm/buyouts/BuyoutsList';
import BuyoutsPager from '@/components/crm/buyouts/BuyoutsPager';
import { PER_PAGE, type BuyoutsData } from '@/components/crm/buyouts/buyoutsShared';

/**
 * Выкупы — что покупатели реально забрали и сколько мы на этом заработали.
 *
 * В ленту попадают ТОЛЬКО выкупленные заказы: это деньги, которые уже наши.
 * Товар в доставке ещё может вернуться, и считать его выручкой рано.
 *
 * По каждой продаже видно цену покупки и маржу из юнит-экономики — сразу
 * понятно, заработали мы на вещи или отдали её себе в убыток. Раньше эти
 * цифры жили в разделе цен, отдельно от денег.
 */
const Buyouts = () => {
  const [page, setPage] = useState(1);
  // Границы периода. По умолчанию пусто — показываем все выкупы.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Площадка и схема. Пусто — смотрим всё вместе.
  const [mp, setMp] = useState('');
  const [scheme, setScheme] = useState('');
  const [data, setData] = useState<BuyoutsData>({
    items: [],
    total: 0,
    pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    fetchBoughtFeed(page, PER_PAGE, dateFrom, dateTo, mp, scheme)
      .then((d) =>
        setData({
          items: d.items || [],
          total: d.total,
          pages: d.pages,
          totals: d.totals,
          breakdown: d.breakdown,
        }),
      )
      .catch(() => setData({ items: [], total: 0, pages: 1 }))
      .finally(() => setLoading(false));
  }, [page, dateFrom, dateTo, mp, scheme]);

  // Смена периода возвращает на первую страницу: оставаться на сотой в новом
  // отборе бессмысленно — там пусто.
  const changeFrom = (v: string) => {
    setDateFrom(v);
    setPage(1);
  };
  const changeTo = (v: string) => {
    setDateTo(v);
    setPage(1);
  };

  /** Выбор среза по площадке и схеме — тоже с возвратом на первую страницу. */
  const changeSlice = (marketplace: string, nextScheme: string) => {
    setMp(marketplace);
    setScheme(nextScheme);
    setPage(1);
  };

  /**
   * Подтянуть свежие продажи с площадки.
   *
   * Выгрузка идёт страницами несколько минут и продолжает себя сама, поэтому
   * ждать её окончания незачем: перечитываем ленту через полминуты, когда
   * первые страницы уже легли в базу.
   */
  const sync = async () => {
    setSyncing(true);
    try {
      await refreshSales(3);
      toast({
        title: 'Обновляем продажи',
        description: 'Свежие выкупы появятся в течение пары минут',
      });
      setTimeout(() => {
        setPage(1);
        fetchBoughtFeed(1, PER_PAGE, dateFrom, dateTo, mp, scheme)
          .then((d) =>
            setData({
              items: d.items || [],
              total: d.total,
              pages: d.pages,
              totals: d.totals,
              breakdown: d.breakdown,
            }),
          )
          .catch(() => undefined);
      }, 30000);
    } catch {
      toast({ title: 'Не удалось запустить', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  /** Быстрый выбор периода: вводить даты руками ради «за месяц» утомительно. */
  const setRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    setDateFrom(fmt(from));
    setDateTo(fmt(to));
    setPage(1);
  };

  return (
    <CrmLayout>
      <div className="space-y-5">
        <BuyoutsHeader total={data.total} syncing={syncing} onSync={sync} />

        <BuyoutsFilters
          breakdown={data.breakdown}
          totals={data.totals}
          mp={mp}
          scheme={scheme}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onSlice={changeSlice}
          onFrom={changeFrom}
          onTo={changeTo}
          onRange={setRange}
        />

        {/* Разбор выручки: сколько забрала площадка, сколько стоило
            производство, сколько ушло налогами и что осталось нам. */}
        {!loading && data.totals?.breakdown && (
          <RevenueBreakdown
            revenue={data.totals.knownRevenue || data.totals.revenue}
            profit={data.totals.profit}
            margin={data.totals.margin}
            breakdown={data.totals.breakdown}
            bonus={data.totals.bonus}
          />
        )}

        <BuyoutsList items={data.items} loading={loading} />

        {!loading && (
          <BuyoutsPager page={page} pages={data.pages} onPage={setPage} />
        )}
      </div>
    </CrmLayout>
  );
};

export default Buyouts;
