import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import Icon from '@/components/ui/icon';
import type { PriceAdvice } from '@/lib/promotionApi';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PriceAdvice[];
  marketplaceTitle: string;
  busy: boolean;
  onConfirm: () => void;
}

const money = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

/**
 * Подтверждение отправки цен на площадку.
 *
 * Отдельное окно, а не просто кнопка: цена уходит прямо на витрину и
 * откатывается только новым запросом. Владелец должен увидеть список целиком
 * и сумму изменений до того, как это станет виден покупателям.
 */
const PricePushConfirm = ({
  open,
  onOpenChange,
  items,
  marketplaceTitle,
  busy,
  onConfirm,
}: Props) => {
  const up = items.filter((i) => i.suggestedPrice > i.currentPrice).length;
  const down = items.length - up;
  // Есть ли товары, где площадка даёт скидку за свой счёт: тогда цена в
  // кабинете отличается от той, что видит покупатель.
  const hasSpp = items.some(
    (i) => i.cardPrice != null && Math.abs(i.cardPrice - i.currentPrice) > 1,
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Изменить цены на {marketplaceTitle}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Новые цены уйдут на витрину сразу — покупатели увидят их в
                течение нескольких минут. Вернуть старые можно только новым
                изменением.
              </p>

              <div className="flex flex-wrap gap-4 rounded-lg border border-border p-3 text-foreground">
                <div>
                  <p className="text-xs text-muted-foreground">Позиций</p>
                  <p className="text-xl font-bold">{items.length}</p>
                </div>
                {up > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Поднимаем</p>
                    <p className="text-xl font-bold text-emerald-700">{up}</p>
                  </div>
                )}
                {down > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground">Снижаем</p>
                    <p className="text-xl font-bold text-amber-700">{down}</p>
                  </div>
                )}
              </div>

              <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                {items.slice(0, 40).map((i) => (
                  <div
                    key={i.itemId}
                    className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-sm last:border-0"
                  >
                    <span className="min-w-0 truncate text-foreground">{i.title}</span>
                    <span className="shrink-0 whitespace-nowrap">
                      <span className="text-muted-foreground">
                        {money(i.currentPrice)}
                      </span>
                      <Icon name="ArrowRight" size={11} className="mx-1 inline" />
                      <span className="font-semibold text-foreground">
                        {money(i.suggestedPrice)} ₽
                      </span>
                    </span>
                  </div>
                ))}
                {items.length > 40 && (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    …и ещё {items.length - 40}
                  </p>
                )}
              </div>

              {/* Цены в списке — те, что видит покупатель после скидки
                  площадки. В кабинете стоит цена выше, и система пересчитает
                  шаг сама. Без этого пояснения цифры выглядят несходящимися. */}
              {hasSpp && (
                <p className="text-xs">
                  Здесь показана цена для покупателя — со скидкой площадки. В
                  кабинете цена выше, система поднимет её на тот же процент.
                </p>
              )}

              <p className="text-xs">
                Позиции, где цена меняется больше чем на четверть, система
                отправлять не станет — такие меняйте в кабинете сами.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={busy}>
            {busy ? (
              <>
                <Icon name="Loader2" size={15} className="mr-1.5 animate-spin" />
                Отправляем…
              </>
            ) : (
              <>
                <Icon name="Upload" size={15} className="mr-1.5" />
                Да, изменить на площадке
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default PricePushConfirm;