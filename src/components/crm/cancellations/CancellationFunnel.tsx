import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { CancellationReport } from '@/lib/cancellationAnalyticsApi';

interface CancellationFunnelProps {
  funnel: CancellationReport['funnel'];
  summary: CancellationReport['summary'];
  days: number;
}

/**
 * Воронка отбора — главный аргумент в обращении к маркетплейсу.
 *
 * Показывает путь от всех заказов до горстки случаев, которые невозможно объяснить
 * обычным поведением покупателя. Каждый шаг отсекает законное объяснение, поэтому
 * разговор с площадкой строится не на «нам кажется», а на «вот сколько было заказов
 * и вот почему остальные отпали».
 */
const CancellationFunnel = ({ funnel, summary, days }: CancellationFunnelProps) => {
  const steps = funnel?.steps || [];
  if (steps.length === 0) return null;

  // Ширина полосы считается от первого шага: так видно, насколько сильно
  // сужается воронка от «всех заказов» к необъяснимым случаям.
  const base = steps[0]?.value || 1;

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon name="Filter" size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Воронка отбора за {days} дн.</p>
            <p className="text-xs text-muted-foreground">
              Как из всех заказов остаются случаи, которые обычным поведением
              покупателя не объясняются
            </p>
          </div>
        </div>

        <div className="space-y-2.5">
          {steps.map((s, i) => {
            const width = Math.max(3, (s.value / base) * 100);
            // Последние шаги — это и есть «выжимка»: подсвечиваем их, чтобы взгляд
            // сразу падал на итог воронки, а не на её широкое начало.
            const isFinal = i >= steps.length - 2;
            return (
              <div key={s.title} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">{s.title}</p>
                  <p className="shrink-0 text-sm tabular-nums">
                    <span className={`font-bold ${isFinal ? 'text-destructive' : ''}`}>
                      {s.value.toLocaleString('ru-RU')}
                    </span>
                    <span className="ml-1.5 text-xs text-muted-foreground">{s.share}%</span>
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isFinal ? 'bg-destructive' : 'bg-primary/60'
                    }`}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <p className="text-xs leading-snug text-muted-foreground">{s.note}</p>
              </div>
            );
          })}
        </div>

        {/* Итог воронки словами: именно эту формулировку и несут в поддержку. */}
        {summary.highRiskBuyers > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3">
            <p className="text-sm font-semibold text-destructive">
              {summary.highRiskBuyers} покупателей · {summary.highRiskItems} вещей ·
              вероятность скупки {summary.avgProbability}%
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              Это заказы, где человек заказывал по несколько вещей и не забрал ни
              одной. Товар был сшит под них и остался у нас. Процент показывает,
              насколько такое поведение выбивается от обычных покупателей в этих же
              данных, — он не берётся на глаз.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CancellationFunnel;
