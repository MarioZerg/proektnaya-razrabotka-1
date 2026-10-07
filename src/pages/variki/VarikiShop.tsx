import { useEffect, useState } from 'react';
import { shopCardImageUrl } from '@/lib/shopCardImage';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchShop,
  buyShopItem,
  type ShopItem,
  type VarikiPurchase,
} from '@/lib/varikiApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import ShopItemCard from '@/components/crm/variki/shop/ShopItemCard';
import MyPurchasesList from '@/components/crm/variki/shop/MyPurchasesList';
import BuyConfirmDialog from '@/components/crm/variki/shop/BuyConfirmDialog';

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
  const [listError, setListError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [confirmItem, setConfirmItem] = useState<ShopItem | null>(null);
  const [visitDate, setVisitDate] = useState('');

  const load = () => {
    setLoading(true);
    fetchShop(user?.id)
      .then((d) => {
        setListError(null);
        setItems(d.items);
        setBalance(d.balance);
        setPurchases(d.purchases);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить магазин');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Первые карточки видны сразу — начинаем качать фото, не дожидаясь отрисовки
  // сетки. Иначе браузер ставит их в очередь после вёрстки и они вспыхивают позже.
  useEffect(() => {
    const hrefs = items
      .map((item) => item.imageUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 6)
      .map((url) => shopCardImageUrl(url));
    const links = hrefs.map((href) => {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = href;
      document.head.appendChild(link);
      return link;
    });
    return () => links.forEach((link) => link.remove());
  }, [items]);

  const handleBuy = async () => {
    if (!confirmItem || !user?.id) return;
    // Дату проверяем и здесь: без неё админ не сможет забронировать место,
    // а варики уже спишутся.
    if (confirmItem.needsVisitDate && !visitDate) {
      toast({ title: 'Выберите дату посещения', variant: 'destructive' });
      return;
    }
    setBuying(true);
    try {
      const res = await buyShopItem(user.id, confirmItem.id, visitDate || undefined);
      toast({
        title: res.instant ? 'Сертификат ваш!' : 'Куплено!',
        description: res.instant
          ? `${res.title} — сертификат уже готов, скачайте его ниже`
          : confirmItem.needsVisitDate
            ? `${res.title} — администратор забронирует место и пришлёт сертификат`
            : `${res.title} — администратор пришлёт купон, он появится здесь`,
      });
      setConfirmItem(null);
      setVisitDate('');
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
          {/* min-w-0 и без shrink-0: на телефоне кнопка с балансом вылезали за
              правый край экрана — блок должен ужиматься, а не распирать страницу. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* Кнопка управления прямо на витрине: раздел меню бывает свёрнут, и
                админ не находил, где заводить подарки и грузить сертификаты. */}
            {user?.role === 'admin' && (
              <Button variant="outline" onClick={() => navigate('/crm/variki/manage')}>
                <Icon name="Settings" size={16} className="mr-1.5" />
                <span className="sm:hidden">Управление</span>
                <span className="hidden sm:inline">Добавить и редактировать</span>
              </Button>
            )}
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 sm:px-4">
              <Icon name="Coins" size={22} className="shrink-0 text-amber-500" />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[10px] uppercase tracking-wide text-amber-800">
                  Ваш баланс
                </div>
                <div className="truncate text-lg font-bold text-amber-900">
                  {balance}&nbsp;шт
                </div>
              </div>
            </div>
          </div>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить магазин"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item, index) => (
                <ShopItemCard
                  key={item.id}
                  item={item}
                  index={index}
                  balance={balance}
                  userId={user?.id}
                  onBuy={setConfirmItem}
                />
              ))}
            </div>

            {purchases.length > 0 && <MyPurchasesList purchases={purchases} userId={user?.id} />}
          </>
        )}
      </div>

      <BuyConfirmDialog
        confirmItem={confirmItem}
        visitDate={visitDate}
        buying={buying}
        onVisitDateChange={setVisitDate}
        onClose={() => {
          setConfirmItem(null);
          setVisitDate('');
        }}
        onBuy={handleBuy}
      />
    </CrmLayout>
  );
};

export default VarikiShop;
