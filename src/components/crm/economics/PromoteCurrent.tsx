import { useState } from 'react';
import Icon from '@/components/ui/icon';
import type { CurrentAction } from '@/lib/promotionApi';
import { money } from './economicsShared';

/**
 * Размеры материала, которые УЖЕ продаются в акциях.
 *
 * Половина вопросов о продвижении — не «кого завести», а «что там сейчас
 * творится»: по какой цене товар сидит в акции и не работаем ли мы в убыток.
 * Раньше это проверялось только в кабинете площадки, размер за размером.
 *
 * Акции с убыточными позициями идут первыми: с ними и надо разбираться.
 */
interface Props {
  actions: CurrentAction[];
}

const PromoteCurrent = ({ actions }: Props) => {
  // Список размеров разворачивается по требованию: их под сотню на акцию.
  const [openId, setOpenId] = useState('');

  if (actions.length === 0) {
    return (
      <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        Размеры этого материала пока ни в одной акции не участвуют
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {actions.map((a) => (
        <div
          key={a.actionId}
          className={`rounded-md border p-2 ${
            a.lossCount > 0
              ? 'border-rose-300 bg-rose-50/60'
              : 'border-border bg-background/60'
          }`}
        >
          <button
            type="button"
            onClick={() => setOpenId((v) => (v === a.actionId ? '' : a.actionId))}
            className="flex w-full items-start justify-between gap-2 text-left"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-xs font-medium">
                <Icon
                  name={openId === a.actionId ? 'ChevronUp' : 'ChevronDown'}
                  size={12}
                />
                {a.title}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {a.count} размеров в акции
                {/* Убыточные — главное, ради чего сюда смотрят. */}
                {a.lossCount > 0 && (
                  <span className="ml-1 font-medium text-rose-700">
                    · {a.lossCount} в минус
                  </span>
                )}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-bold">{money(a.avgProfit)} ₽</p>
              <p className="text-[11px] text-muted-foreground">
                маржа {a.avgMargin}%
              </p>
            </div>
          </button>

          {openId === a.actionId && (
            <div className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
              {a.items.map((i) => (
                <div
                  key={i.offerId}
                  className="flex items-center justify-between gap-2 text-[11px]"
                >
                  <span className="min-w-0 truncate">{i.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {/* Цена участия — по ней товар реально продаётся. */}
                    <span className="text-muted-foreground">
                      {money(i.actionPrice)} ₽
                    </span>
                    <span
                      className={`w-16 text-right font-medium ${
                        i.profit > 0 ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {i.profit > 0 ? '+' : ''}
                      {money(i.profit)} ₽
                    </span>
                    <span className="w-10 text-right text-muted-foreground">
                      {i.margin}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default PromoteCurrent;
