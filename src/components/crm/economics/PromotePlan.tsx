import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchMaterialPlan,
  joinAction,
  type CurrentAction,
  type PlanAction,
} from '@/lib/promotionApi';
import PromoteCurrent from './PromoteCurrent';
import { money } from './economicsShared';

/**
 * План продвижения по всему материалу.
 *
 * Решение о скидках принимается по материалу целиком: у «Бамбука» полтора
 * десятка ширин и сотня размеров, и заводить их по одному — работа на день.
 *
 * Акции идут в порядке очерёдности — сначала та, где скидка обходится дешевле
 * всего. После каждой видно, какой станет средняя маржа по ассортименту, и как
 * только она опускается ниже порога, остальные помечаются «стоп».
 */
interface Props {
  /** Материал целиком: все ширины и высоты. */
  material: string;
  onDone: () => void;
}

const PromotePlan = ({ material, onDone }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [minAvg, setMinAvg] = useState('4.5');
  const [plan, setPlan] = useState<PlanAction[]>([]);
  // Кто уже в акциях: по какой цене сидит и с какой маржой.
  const [current, setCurrent] = useState<CurrentAction[]>([]);
  const [base, setBase] = useState<{ margin: number; sizes: number }>({
    margin: 0,
    sizes: 0,
  });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  // Выбранная глубина скидки по каждой акции.
  //
  // По умолчанию 0 — цена по потолку площадки, то есть минимум скидки. Так
  // товар попадёт в максимум акций, не растратив запас прибыли на первой же.
  // Углубить можно осознанно, видя, во что это встанет.
  const [depth, setDepth] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true);
    fetchMaterialPlan(material, user?.id, Number(minAvg) || 0)
      .then((d) => {
        setPlan(d.actions);
        setCurrent(d.current || []);
        setBase({ margin: d.baseAvgMargin, sizes: d.sizes });
      })
      .catch(() => {
        setPlan([]);
        setCurrent([]);
      })
      .finally(() => setLoading(false));
  }, [material, minAvg, user?.id]);

  const join = async (a: PlanAction) => {
    setBusyId(a.actionId);
    try {
      const res = await joinAction({
        actionId: a.actionId,
        offerIds: a.items.filter((i) => i.eligible).map((i) => i.offerId),
        minMargin: 0,
        extraDiscount: depth[a.actionId] || 0,
        actorId: user?.id,
        actorName: user?.name,
      });
      toast({
        title: `Заведено в «${a.title}»`,
        description: `${res.joined} размеров`,
      });
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось завести',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Минимальная средняя маржа по ассортименту, %</Label>
        <Input
          type="number"
          step="0.5"
          value={minAvg}
          onChange={(e) => setMinAvg(e.target.value)}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          Скидка в одной акции терпима, но если завести материал во все разом,
          прибыль просядет до нуля. Ниже этой границы акции не предлагаются
        </p>
      </div>

      {!loading && base.sizes > 0 && (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          {material}: {base.sizes} размеров, средняя маржа сейчас{' '}
          <span className="font-medium text-foreground">{base.margin}%</span>
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={14} className="animate-spin" />
          Считаем все акции по всем размерам…
        </div>
      )}

      {/* СНАЧАЛА — что уже происходит.
          Прежде чем заводить новое, надо видеть текущую картину: где товар
          уже продаётся со скидкой и во что это обходится. Иначе решение
          принимается вслепую. */}
      {!loading && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Уже участвуют</p>
          <PromoteCurrent actions={current} />
        </div>
      )}

      {!loading && plan.length > 0 && (
        <p className="pt-1 text-xs font-medium">Можно завести</p>
      )}

      {!loading && plan.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Площадка не предлагает размеры этого материала ни в одну акцию
        </p>
      )}

      <div className="space-y-2">
        {plan.map((a, i) => (
          <div
            key={a.actionId}
            className={`rounded-md border p-2 ${
              a.recommended
                ? 'border-emerald-300 bg-emerald-50/60'
                : 'border-border bg-muted/30'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {/* Номер очереди: с какой акции начинать. */}
                  <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                  {a.title}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {/* Уже заведённые отмечаем: «завести» здесь значило бы
                      перезавести, а не расширить охват. */}
                  {!!a.alreadyIn && (
                    <span className="mr-1 font-medium text-foreground">
                      В акции уже {a.alreadyIn} ·
                    </span>
                  )}
                  Проходят {a.fits} из {a.total} размеров
                  {a.newItems > 0 && ` · новых ${a.newItems}`}
                  {a.dateEnd && ` · до ${a.dateEnd}`}
                </p>
                <p
                  className={`mt-0.5 text-[11px] ${
                    a.recommended ? 'text-emerald-800' : 'text-muted-foreground'
                  }`}
                >
                  {a.reason}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-bold">{a.avgAfter}%</p>
                <p className="text-[11px] text-muted-foreground">
                  {/* Цена скидки: сколько прибыли отдаём с каждой вещи. */}
                  −{money(a.profitDrop)} ₽/шт
                </p>
              </div>
            </div>
            {a.recommended && a.newItems > 0 && (
              <>
                {/* ГЛУБИНА СКИДКИ.
                    Площадка называет потолок цены — минимум, какой она
                    примет. Заходить всегда по нему значит получать минимум
                    буста, а сразу глубоко — растратить весь запас прибыли на
                    одной акции. Показываем варианты с готовой цифрой прибыли:
                    запас можно разложить между несколькими акциями. */}
                {!!a.options?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {a.options.map((o) => {
                      const active = (depth[a.actionId] || 0) === o.extraDiscount;
                      return (
                        <button
                          key={o.extraDiscount}
                          type="button"
                          onClick={() =>
                            setDepth((d) => ({
                              ...d,
                              [a.actionId]: o.extraDiscount,
                            }))
                          }
                          className={`rounded border px-1.5 py-1 text-[11px] leading-tight ${
                            active
                              ? 'border-primary bg-primary/10 font-medium'
                              : 'border-border bg-background/60'
                          }`}
                        >
                          <span className="block">
                            {o.extraDiscount === 0
                              ? 'минимум'
                              : `−${o.extraDiscount}%`}
                          </span>
                          <span className="block text-muted-foreground">
                            {money(o.avgProfit)} ₽ · {o.avgMargin}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1.5 h-7 w-full text-xs"
                  disabled={!!busyId}
                  onClick={() => join(a)}
                >
                  {busyId === a.actionId
                    ? 'Заводим…'
                    : `Завести ${a.fits} размеров`}
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PromotePlan;
