import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Promotion } from '@/lib/promotionApi';

interface Props {
  items: Promotion[];
}

/** Вердикт по акции: идти, осторожно или мимо. */
const VERDICT = {
  good: {
    label: 'Участвуем',
    className: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-100',
    icon: 'CircleCheck',
    hint: 'Маржа остаётся в норме',
  },
  risky: {
    label: 'Осторожно',
    className: 'bg-amber-100 text-amber-900 hover:bg-amber-100',
    icon: 'TriangleAlert',
    hint: 'Заработок сильно просядет',
  },
  bad: {
    label: 'Не идём',
    className: 'bg-destructive/10 text-destructive hover:bg-destructive/10',
    icon: 'CircleX',
    hint: 'Работа в убыток',
  },
} as const;

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '—';

/**
 * Акции площадок с расчётом выгоды.
 *
 * Площадка обещает продвижение, но требует срезать цену. Здесь видно, во что
 * это обойдётся: какая маржа останется и сколько позиций уйдёт в минус.
 * Сортируем по выгоде — сверху то, куда идти стоит.
 */
const PromotionsList = ({ items }: Props) => {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <Icon name="Megaphone" size={28} className="mx-auto text-muted-foreground" />
        <p className="mt-2 font-medium">Акций пока нет</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Нажмите «Обновить акции» — система спросит у площадок, куда нас зовут
        </p>
      </div>
    );
  }

  const sorted = [...items].sort(
    (a, b) => (b.avgMargin ?? -999) - (a.avgMargin ?? -999),
  );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {sorted.map((p) => {
        const v = p.verdict ? VERDICT[p.verdict as keyof typeof VERDICT] : null;
        return (
          <div
            key={`${p.marketplaceCode}-${p.externalId}`}
            className="rounded-lg border border-border p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium leading-tight">{p.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.marketplaceTitle} · {formatDate(p.dateStart)} —{' '}
                  {formatDate(p.dateEnd)}
                </p>
              </div>
              {v && (
                <Badge className={`${v.className} shrink-0`} variant="secondary">
                  <Icon name={v.icon} size={12} className="mr-1" />
                  {v.label}
                </Badge>
              )}
            </div>

            {p.avgMargin != null ? (
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Маржа в акции</p>
                  <p className="text-xl font-bold">{p.avgMargin}%</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Уйдут в минус</p>
                  <p className="text-xl font-bold">
                    {p.lossmakingCount}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      из {p.itemsCount}
                    </span>
                  </p>
                </div>
                {v && (
                  <p className="text-xs text-muted-foreground">{v.hint}</p>
                )}
              </div>
            ) : (
              /* Площадка зовёт, но цены участия ещё не посчитаны: у WB их
                 в открытом виде нет, поэтому вердикта по таким акциям не будет. */
              <p className="mt-3 text-xs text-muted-foreground">
                Площадка не отдаёт цены участия — выгоду посчитать нельзя,
                проверьте условия в кабинете
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default PromotionsList;
