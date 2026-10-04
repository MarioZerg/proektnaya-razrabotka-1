import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMissedAccruals,
  dismissMissedAccrual,
  accrueMissed,
  type MissedAccrual,
} from '@/lib/salaryApi';
import { formatDate } from '@/lib/dateUtils';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

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
  const [listError, setListError] = useState<string | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const [accruing, setAccruing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = () =>
    fetchMissedAccruals()
      .then((list) => {
        setListError(null);
        setItems(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить пропуски');
      });

  useEffect(() => {
    load();
  }, []);

  // Доначислить одной кнопкой: ставки уже заведены, а начисление не создалось —
  // руками это значило открыть каждый заказ и посчитать сумму заново.
  const handleAccrue = async (item: MissedAccrual) => {
    const key = `${item.userId}-${item.stage}`;
    setAccruing(key);
    try {
      const r = await accrueMissed(item, user?.id, user?.name);
      if (r.created > 0) {
        toast({
          title: `Доначислено ${r.created} шт на ${r.amount.toLocaleString('ru-RU')} ₽`,
          description: r.skipped
            ? `${item.userName}: ещё ${r.skipped} заказов пропущено — для них не заведена ставка`
            : item.userName,
        });
      } else {
        // Ставки нет — сумму придумывать нельзя, честно говорим почему.
        toast({
          title: 'Начислить не удалось',
          description:
            'Для этих заказов не заведена ставка или не проставлен цех. Заполните их в настройках зарплат и нажмите ещё раз.',
          variant: 'destructive',
        });
      }
      await load();
    } catch (e) {
      toast({
        title: 'Не удалось доначислить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setAccruing(null);
    }
  };

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

  if (listError && items.length === 0) {
    return (
      <WarehouseFetchError
        title="Не удалось проверить пропущенные начисления"
        description={listError}
        onRetry={load}
      />
    );
  }

  if (items.length === 0) return null;

  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <div className="overflow-hidden rounded-lg border border-amber-300 bg-amber-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-amber-100/70"
      >
        <Icon name="TriangleAlert" size={16} className="shrink-0 text-amber-600" />
        <Icon
          name="ChevronRight"
          size={14}
          className={`shrink-0 text-amber-700 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-900">
          Работа без начисления
        </p>
        <span className="shrink-0 rounded-sm bg-amber-200 px-1.5 py-0.5 text-xs font-bold tabular-nums text-amber-900">
          {total} шт · {items.length}
        </span>
      </button>

      {open && (
        <div className="border-t border-amber-200 px-3 py-3">
          <p className="text-xs leading-snug text-amber-900">
            Этапы выполнены, но зарплата за них не начислена. «Доначислить» — по
            заведённым ставкам. Если дыра объяснима — уберите строку крестиком.
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
                    onClick={() => handleAccrue(i)}
                    disabled={accruing === key}
                    title="Начислить зарплату за эти заказы по заведённым ставкам"
                    className="ml-auto shrink-0 rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-50"
                  >
                    {accruing === key ? (
                      <span className="flex items-center gap-1">
                        <Icon name="Loader2" size={12} className="animate-spin" />
                        Начисляю
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Icon name="Wallet" size={12} />
                        Доначислить
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismiss(i)}
                    disabled={hiding === key}
                    title="Убрать это предупреждение"
                    className="shrink-0 rounded-sm p-0.5 text-amber-700 hover:bg-amber-200 hover:text-amber-900 disabled:opacity-50"
                  >
                    <Icon
                      name={hiding === key ? 'Loader2' : 'X'}
                      size={14}
                      className={hiding === key ? 'animate-spin' : ''}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MissedAccrualsAlert;
