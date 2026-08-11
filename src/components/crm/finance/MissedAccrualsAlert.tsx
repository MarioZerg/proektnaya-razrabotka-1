import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { fetchMissedAccruals, type MissedAccrual } from '@/lib/salaryApi';
import { formatDate } from '@/lib/dateUtils';

/**
 * Предупреждение: люди работали, а денег им не начислили.
 *
 * Начисление создаётся в момент завершения этапа. Если в этот момент чего-то не
 * хватило (у заказа не проставлен цех, не заведена ставка), начисление молча НЕ
 * создаётся: ошибки никто не видит, человек просто остаётся без денег, а в отчётах
 * выглядит как не работавший. Так одна швея отшила 23 заказа и не получила ничего —
 * заметили случайно, спустя дни.
 *
 * Блок висит наверху финансов и показывает такие дыры сам. Пусто — блок не рисуется.
 */
const MissedAccrualsAlert = () => {
  const [items, setItems] = useState<MissedAccrual[]>([]);

  useEffect(() => {
    fetchMissedAccruals()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <Icon name="TriangleAlert" size={20} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-amber-900">
            Работа без начисления: {total} шт
          </p>
          <p className="mt-0.5 text-sm text-amber-900">
            Этапы выполнены, но зарплата за них не начислена — проверьте ставки и цех
            у этих заказов.
          </p>

          <div className="mt-3 space-y-1.5">
            {items.map((i) => (
              <div
                key={`${i.userId}-${i.stage}`}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-amber-900"
              >
                <span className="font-medium">{i.userName}</span>
                <span className="rounded-sm bg-amber-200 px-1.5 text-xs font-medium">
                  {i.stage}
                </span>
                <span className="font-semibold">{i.count} шт</span>
                {i.dateFrom && (
                  <span className="text-xs text-amber-800">
                    {i.dateFrom === i.dateTo
                      ? formatDate(i.dateFrom)
                      : `${formatDate(i.dateFrom)} — ${formatDate(i.dateTo || i.dateFrom)}`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MissedAccrualsAlert;
