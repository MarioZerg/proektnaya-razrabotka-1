import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import SpaAnimation from '@/components/crm/variki/SpaAnimation';
import {
  fetchShop,
  buyShopItem,
  type ShopItem,
  type VarikiPurchase,
} from '@/lib/varikiApi';
import { formatDateTime } from '@/lib/dateUtils';

/**
 * Магазин вариков: сотрудник тратит игровую валюту на настоящие подарки.
 *
 * Купон приходит не сразу: после покупки заявка уходит администратору, тот
 * прикрепляет PDF-сертификат, и он появляется здесь же. Сертификаты покупаются
 * на стороне, автоматически их выдать неоткуда — поэтому шаг с админом честно
 * показан сотруднику, чтобы он не ждал купон мгновенно.
 */
const VarikiShop = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [purchases, setPurchases] = useState<VarikiPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [confirmItem, setConfirmItem] = useState<ShopItem | null>(null);

  const load = () => {
    setLoading(true);
    fetchShop(user?.id)
      .then((d) => {
        setItems(d.items);
        setBalance(d.balance);
        setPurchases(d.purchases);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleBuy = async () => {
    if (!confirmItem || !user?.id) return;
    setBuying(true);
    try {
      const res = await buyShopItem(user.id, confirmItem.id);
      toast({
        title: res.instant ? 'Сертификат ваш!' : 'Куплено!',
        description: res.instant
          ? `${res.title} — сертификат уже готов, скачайте его ниже`
          : `${res.title} — администратор пришлёт купон, он появится здесь`,
      });
      setConfirmItem(null);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось купить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBuying(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Магазин вариков</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Обменяйте накопленные варики на подарки
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Кнопка управления прямо на витрине: раздел меню бывает свёрнут, и
                админ не находил, где заводить подарки и грузить сертификаты. */}
            {user?.role === 'admin' && (
              <Button variant="outline" onClick={() => navigate('/crm/variki/manage')}>
                <Icon name="Settings" size={16} className="mr-1.5" />
                Добавить и редактировать
              </Button>
            )}
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-4 py-2">
            <Icon name="Coins" size={22} className="text-amber-500" />
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-wide text-amber-800">
                Ваш баланс
              </div>
              <div className="whitespace-nowrap text-lg font-bold text-amber-900">
                {balance}&nbsp;шт
              </div>
            </div>
          </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const enough = balance >= item.price;
                const soldOut = item.available === 0;
                return (
                  <div
                    key={item.id}
                    className="relative flex min-h-[19rem] flex-col overflow-hidden rounded-xl border border-border bg-card"
                  >
                    {/* Фотография подарка: по одной анимации пузырьков непонятно,
                        ЧТО покупаешь. Снимок делает награду наглядной, а пузырьки
                        поверх воды на нём оживляют карточку. */}
                    {item.imageUrl && (
                      <div className="relative h-40 shrink-0 overflow-hidden">
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {item.animation === 'spa' && <SpaAnimation />}
                        {/* Плавный переход от фото к карточке, чтобы снимок не
                            обрывался резкой линией. */}
                        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-card" />
                      </div>
                    )}
                    {!item.imageUrl && item.animation === 'spa' && <SpaAnimation />}

                    <div className="relative flex flex-1 flex-col p-5">
                      {!item.imageUrl && (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/80 shadow-sm ring-1 ring-cyan-200">
                          <Icon name={item.icon} size={34} className="text-cyan-600" />
                        </div>
                      )}

                      <h2 className="text-lg font-bold leading-tight">{item.title}</h2>
                      {item.description && (
                        <p className="mt-1 text-sm text-foreground/80">{item.description}</p>
                      )}

                      <div className="mt-auto space-y-2 pt-4">
                        <div className="flex items-center gap-2">
                          <Icon name="Coins" size={20} className="text-amber-500" />
                          <span className="whitespace-nowrap text-2xl font-bold">
                            {item.price}
                          </span>
                          <span className="text-sm text-muted-foreground">вариков</span>
                        </div>

                        {/* Не хватает — говорим СКОЛЬКО именно: так виден понятный
                            ориентир, а не глухое «недостаточно средств». */}
                        {!enough && !soldOut && (
                          <p className="text-xs font-medium text-muted-foreground">
                            Не хватает {item.price - balance} вариков
                          </p>
                        )}

                        {/* Остаток показываем, только когда он МАЛЕНЬКИЙ: «осталось 2»
                            подталкивает решиться, а «осталось 47» — просто шум. */}
                        {!soldOut && item.available <= 3 && (
                          <p className="text-xs font-semibold text-amber-700">
                            Осталось {item.available}
                            {item.stockLimit ? ` из ${item.stockLimit}` : ''}
                          </p>
                        )}

                        <Button
                          className="w-full"
                          disabled={!enough || !user?.id || soldOut}
                          onClick={() => setConfirmItem(item)}
                        >
                          <Icon
                            name={soldOut ? 'PackageX' : 'ShoppingBag'}
                            size={16}
                            className="mr-1.5"
                          />
                          {soldOut ? 'Закончились' : 'Купить'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {purchases.length > 0 && (
              <div className="rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-4 py-2 text-sm font-semibold">
                  Мои покупки
                </div>
                <div className="divide-y divide-border">
                  {purchases.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{p.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.createdAt ? formatDateTime(p.createdAt) : ''} · {p.price} вариков
                        </p>
                        {p.status === 'cancelled' && p.cancelReason && (
                          <p className="mt-0.5 text-xs text-destructive">
                            Отменено: {p.cancelReason}. Варики возвращены
                          </p>
                        )}
                      </div>

                      {p.status === 'issued' && p.couponUrl ? (
                        <Button asChild variant="default" className="shrink-0">
                          <a href={p.couponUrl} target="_blank" rel="noreferrer">
                            <Icon name="FileDown" size={16} className="mr-1.5" />
                            Скачать купон
                          </a>
                        </Button>
                      ) : p.status === 'pending' ? (
                        <Badge variant="secondary" className="shrink-0">
                          Ждём купон от администратора
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0">
                          Отменено
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog open={!!confirmItem} onOpenChange={(v) => !v && setConfirmItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Купить за {confirmItem?.price} вариков?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmItem?.title}. Варики спишутся сразу.{' '}
              {confirmItem && confirmItem.available > 0
                ? 'Сертификат вы получите тут же — ждать не нужно.'
                : 'Купон пришлёт администратор — он появится на этой странице.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={buying}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleBuy} disabled={buying}>
              {buying ? 'Покупаем...' : 'Купить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default VarikiShop;