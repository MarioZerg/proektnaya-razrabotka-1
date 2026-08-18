import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMissedAccruals,
  dismissMissedAccrual,
  type MissedAccrual,
} from '@/lib/salaryApi';
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
 *
 * Крестик у строки: иногда дыра объяснима — заказ переносили руками, этап закрыли
 * задним числом, деньги выдали наличными. Раньше такая строка висела вечно, на неё
 * переставали смотреть и вместе с ней пропускали настоящие потери. Скрытая строка
 * вернётся сама, если у человека на этом этапе появятся НОВЫЕ незакрытые заказы.
 */
const MissedAccrualsAlert = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<MissedAccrual[]>([]);
  const [hiding, setHiding] = useState<string | null>(null);

  useEffect(() => {
    fetchMissedAccruals()
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  const handleDismiss = async (item: MissedAccrual) => {
    const key = `${item.userId}-${item.stage}`;
    setHiding(key);
    try {
      await dismissMissedAccrual(item, user?.id, user?.name);
      setItems((prev) =>
        prev.filter((i) => `${i.userId}-${i.stage}` !== key),
      );
    } catch (e) {
      toast({
        title: 'Не удалось скрыть',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setHiding(null);
    }
  };

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
            у этих заказов. Разобрались — уберите строку крестиком.
          </p>

          <div className="mt-3 space-y-1.5">
            {items.map((i) => {
              const key = `${i.userId}-${i.stage}`;
              return (
                <div
                  key={key}
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
                  <button
                    type="button"
                    onClick={() => handleDismiss(i)}
                    disabled={hiding === key}
                    title="Убрать это предупреждение"
                    className="ml-auto shrink-0 rounded-sm p-0.5 text-amber-700 hover:bg-amber-200 hover:text-amber-900 disabled:opacity-50"
                  >
                    <Icon name={hiding === key ? 'Loader2' : 'X'} size={14} className={hiding === key ? 'animate-spin' : ''} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MissedAccrualsAlert;
