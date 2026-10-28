import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { fetchSiteOrdersProfit, type SiteOrdersProfit } from '@/lib/siteOrdersApi';

const rub = (v: number | null | undefined) =>
  v == null ? '—' : `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Реальная прибыль заказов сайта: налог и эквайринг со всей оплаты, включая доставку. */
const SiteOrdersProfitTab = () => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<SiteOrdersProfit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSiteOrdersProfit(month));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const t = data?.totals;
  const cards: [string, number | undefined, string?][] = [
    ['Оплатили покупатели', t?.paid],
    ['Налог и эквайринг', t ? t.tax + t.acquiring : undefined, 'со всей суммы, включая доставку'],
    ['Ozon за доставку', t?.ozon],
    ['Блогерам', t?.blogger, 'только от товара'],
    ['Себестоимость', t?.cost],
    ['Чистая прибыль', t?.profit],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Налог и эквайринг берутся со всей оплаты покупателя — товар плюс доставка. Блогер получает только от
          товара. Ozon — сколько реально стоила доставка из Ярославля.
        </p>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value, hint]) => (
          <Card key={label} className="p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold">{rub(value)}</p>
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
          </Card>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={14} className="animate-spin" /> Загружаю…
        </p>
      )}

      {data && data.orders.length === 0 && (
        <p className="text-sm text-muted-foreground">Заказов с сайта за этот месяц нет.</p>
      )}

      {data && data.orders.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['Заказ', 'Город', 'Товар', 'Доставка', 'Оплата', 'Налог + экв.', 'Ozon', 'Блогер', 'Себест.', 'Прибыль'].map(
                  (h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{o.orderNumber}</div>
                    <div className="text-xs text-muted-foreground">{o.product}</div>
                  </td>
                  <td className="px-3 py-2">{o.city || '—'}</td>
                  <td className="px-3 py-2">{rub(o.goods)}</td>
                  <td className="px-3 py-2">{rub(o.delivery)}</td>
                  <td className="px-3 py-2 font-medium">{rub(o.paid)}</td>
                  <td className="px-3 py-2 text-muted-foreground">−{rub(o.tax + o.acquiring)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{o.ozon == null ? '—' : `−${rub(o.ozon)}`}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {o.partnerCode ? (
                      <span title={o.partnerCode}>−{rub(o.blogger)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{o.cost == null ? '—' : `−${rub(o.cost)}`}</td>
                  <td
                    className={`px-3 py-2 font-semibold ${
                      o.profit == null ? '' : o.profit < 0 ? 'text-destructive' : 'text-emerald-700'
                    }`}
                  >
                    {rub(o.profit)}
                    {!o.complete && o.profit != null && (
                      <div className="text-[11px] font-normal text-amber-700">
                        {o.ozon == null ? 'нет тарифа Ozon' : o.cost == null ? 'нет себестоимости' : ''}
                      </div>
                    )}
                    {o.goods == null && (
                      <div className="text-[11px] font-normal text-muted-foreground">сайт не прислал цену</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SiteOrdersProfitTab;
