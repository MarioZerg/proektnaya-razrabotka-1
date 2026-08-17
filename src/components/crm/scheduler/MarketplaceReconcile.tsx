import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchReconcile,
  pullMissingOzon,
  type ReconcileMarketplace,
} from '@/lib/marketplaceReconcileApi';

const SOURCES: { key: 'ozon' | 'wb' | 'ym'; title: string }[] = [
  { key: 'ozon', title: 'OZON' },
  { key: 'wb', title: 'WildBerries' },
  { key: 'ym', title: 'Яндекс Маркет' },
];

/**
 * Сверка с маркетплейсами: заказы на площадке против заказов у нас.
 *
 * Планировщик выше показывает, что задания ЗАПУСКАЮТСЯ. Но запускаться они могут и
 * впустую: так однажды 117 заказов OZON висели в «ожидает сборки» на площадке, а до
 * цеха не доехали — загрузка работала, просто листала список не с той стороны.
 * Заметили это спустя недели и случайно.
 *
 * Эта сверка спрашивает площадку напрямую: сколько у тебя заказов? — и сравнивает с
 * тем, что есть у нас. Расхождение видно сразу, а не через недели.
 *
 * Опрашиваем по одной площадке за раз: опрос всех трёх разом не укладывается в
 * отведённое время. Запуск ручной — это тяжёлый запрос, дёргать его каждую минуту
 * фоном незачем.
 */
const MarketplaceReconcile = () => {
  const { toast } = useToast();
  const [data, setData] = useState<Record<string, ReconcileMarketplace>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const check = async (key: 'ozon' | 'wb' | 'ym') => {
    setLoading(key);
    try {
      const res = await fetchReconcile(key);
      setData((prev) => ({ ...prev, [key]: res }));
    } catch (e) {
      setData((prev) => ({
        ...prev,
        [key]: {
          key,
          title: SOURCES.find((s) => s.key === key)!.title,
          enabled: true,
          error: e instanceof Error ? e.message : 'Ошибка',
          rows: [],
        },
      }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="font-bold">Сверка с площадками</h2>
        <p className="text-sm text-muted-foreground">
          Сколько заказов на маркетплейсе и сколько доехало до нас
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SOURCES.map((s) => {
          const d = data[s.key];
          // Потеря заказов — это остановленное производство, поэтому красим тревожно.
          const missing = d?.rows.reduce((acc, r) => acc + Math.max(0, r.missing), 0) ?? 0;
          const border = !d
            ? 'border-border'
            : d.error
              ? 'border-amber-300 bg-amber-50'
              : missing > 0
                ? 'border-rose-300 bg-rose-50'
                : 'border-emerald-300 bg-emerald-50';

          return (
            <Card key={s.key} className={`shadow-none ${border}`}>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold">{s.title}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => check(s.key)}
                    disabled={loading === s.key}
                  >
                    <Icon
                      name={loading === s.key ? 'Loader2' : 'RefreshCw'}
                      size={14}
                      className={`mr-1 ${loading === s.key ? 'animate-spin' : ''}`}
                    />
                    Сверить
                  </Button>
                </div>

                {!d && (
                  <p className="text-sm text-muted-foreground">
                    Нажмите «Сверить» — система спросит площадку напрямую
                  </p>
                )}

                {d?.error && (
                  <p className="text-sm text-amber-900">
                    {d.error}. Заказы при этом могут быть в порядке — площадка просто не
                    ответила, попробуйте ещё раз
                  </p>
                )}

                {d && !d.error && !d.enabled && (
                  <p className="text-sm text-muted-foreground">Интеграция выключена</p>
                )}

                {d?.rows.map((r) => (
                  <div key={r.title} className="text-sm">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-muted-foreground">
                      на площадке {r.onMarketplace} · у нас {r.inSystem}
                    </p>
                    {r.missing > 0 ? (
                      <p className="font-bold text-rose-700">
                        Не доехало: {r.missing} — цех про них не знает
                      </p>
                    ) : (
                      <p className="text-emerald-700">Всё сходится</p>
                    )}
                  </div>
                ))}

                {d && !d.error && d.enabled && missing > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-rose-900">
                      Загрузка подтянет их сама в ближайшие запуски. Не хотите ждать —
                      заберите сейчас
                    </p>
                    {/* Догрузка есть только у OZON: там заказы идут сплошным потоком и
                        ждать четверть часа дороже всего. У WB и Яндекса поток меньше,
                        плановой загрузки хватает. */}
                    {s.key === 'ozon' && (
                      <Button
                        size="sm"
                        disabled={pulling}
                        onClick={async () => {
                          const numbers = d.rows.flatMap((r) => r.missingNumbers ?? []);
                          if (!numbers.length) return;
                          setPulling(true);
                          try {
                            const res = await pullMissingOzon(numbers);
                            toast({
                              title: `Догружено заказов: ${res.created}`,
                              description: 'Они уже на конвейере',
                            });
                            await check('ozon');
                          } catch (err) {
                            toast({
                              title: 'Не удалось догрузить',
                              description: err instanceof Error ? err.message : undefined,
                              variant: 'destructive',
                            });
                          } finally {
                            setPulling(false);
                          }
                        }}
                      >
                        <Icon
                          name={pulling ? 'Loader2' : 'Download'}
                          size={14}
                          className={`mr-1 ${pulling ? 'animate-spin' : ''}`}
                        />
                        Догрузить сейчас
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default MarketplaceReconcile;
