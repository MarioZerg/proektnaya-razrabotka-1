import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { formatRub, normalizeSearch } from '@/components/crm/promotion/raiseShared';
import type { PriceAdvice } from '@/lib/promotionApi';

interface Props {
  /** Все советы площадки: считаются по марже, рекламе и скидке площадки. */
  advice: PriceAdvice[] | null;
  /** Включён ли фильтр «только требующие подъёма» в таблице ниже. */
  onlyAdvice: boolean;
  onOnlyAdviceChange: (on: boolean) => void;
}

/**
 * Товары, которым цену пора поднять.
 *
 * Раньше эти советы считались на сервере, но на экран не выводились: владелец
 * видел весь ассортимент и должен был сам угадывать, где маржа просела. Здесь
 * они собраны в один список — с причиной и рекомендуемой ценой, чтобы решение
 * было видно, а не подразумевалось.
 *
 * Список свой, отдельный от таблицы подъёма: там выбирают, что отправить, а
 * здесь смотрят, что вообще стоит трогать. Кнопка связывает одно с другим —
 * оставляет в таблице только эти карточки.
 */
const RobotAdviceCard = ({ advice, onlyAdvice, onOnlyAdviceChange }: Props) => {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  const raiseItems = useMemo(
    () => (advice || []).filter((i) => i.action === 'raise'),
    [advice],
  );

  const visible = useMemo(() => {
    const q = normalizeSearch(search);
    if (!q) return raiseItems;
    return raiseItems.filter((i) =>
      normalizeSearch(`${i.title} ${i.sku || ''}`).includes(q),
    );
  }, [raiseItems, search]);

  const shown = expanded ? visible : visible.slice(0, 10);

  if (advice === null) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Считаем, каким товарам нужен подъём…
        </CardContent>
      </Card>
    );
  }

  if (raiseItems.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="font-semibold">Требуют подъёма</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Сейчас таких карточек нет: у всех либо маржа в норме, либо цену
            меняли недавно и надо выждать. Поднять вручную можно ниже.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">
              Требуют подъёма: {raiseItems.length}
            </h3>
            <p className="text-xs text-muted-foreground">
              Маржа ниже нужной — цену стоит поднять. Рядом видно, какую цену
              советует система и почему.
            </p>
          </div>
          <Button
            variant={onlyAdvice ? 'default' : 'outline'}
            size="sm"
            onClick={() => onOnlyAdviceChange(!onlyAdvice)}
          >
            <Icon
              name={onlyAdvice ? 'Check' : 'ListFilter'}
              size={15}
              className="mr-1.5"
            />
            {onlyAdvice ? 'Показаны только они' : 'Оставить их в подъёме'}
          </Button>
        </div>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Найти: название, ткань или артикул"
        />

        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
            Ничего не нашлось. Попробуйте часть названия или артикул.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-md border border-border">
              {shown.map((i) => (
                <li key={i.itemId} className="p-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-medium">{i.title}</span>
                    <span className="tabular-nums">
                      {formatRub(i.currentPrice)}
                      <Icon
                        name="ArrowRight"
                        size={13}
                        className="mx-1 inline align-middle text-muted-foreground"
                      />
                      <span className="font-semibold text-emerald-700">
                        {formatRub(i.suggestedPrice)}
                      </span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {i.sku ? `${i.sku} · ` : ''}
                    маржа {i.currentMargin.toFixed(1)}%
                    {i.expectedMargin != null
                      ? ` → ${i.expectedMargin.toFixed(1)}%`
                      : ''}
                    {i.reason ? ` · ${i.reason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
            {visible.length > shown.length && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(true)}
              >
                Показать все {visible.length}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default RobotAdviceCard;