import { useCallback, useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import RobotTabPanel from '@/components/crm/promotion/RobotTabPanel';
import {
  fetchRobotStatus,
  moveRobotPricesAll,
  type RobotMarketplace,
  type RobotStatus,
} from '@/lib/priceRobotApi';
import { fetchOverview, type PriceAdvice } from '@/lib/promotionApi';

const MARKETPLACES: { code: RobotMarketplace; label: string }[] = [
  { code: 'ozon', label: 'OZON' },
  { code: 'wildberries', label: 'Wildberries' },
  { code: 'yandex_market', label: 'Яндекс Маркет' },
];

/**
 * Продвижение — ручной подъём цен.
 *
 * Автоматика по спросу убрана: она судила о продажах по выгрузке, а выгрузка
 * может отстать. 28 августа из-за этого откатились 613 карточек. Советы по
 * товарам тоже убраны: точечная работа шла через них, а теперь тот же смысл
 * у фильтра — поднять только выбранную ткань или ширину.
 *
 * Одно нажатие поднимает выбранные карточки: цены уходят пачками, досыл идёт
 * сам. Шаг мелкий специально — резкий подъём выбрасывает товар из скидки
 * площадки.
 */
const PromotionPage = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [marketplace, setMarketplace] = useState<RobotMarketplace>('ozon');
  const [busy, setBusy] = useState(false);
  const [moveProgress, setMoveProgress] = useState<string | null>(null);
  const [robot, setRobot] = useState<RobotStatus | null>(null);
  // Советы считаются отдельной функцией: она смотрит маржу, рекламу и СПП.
  // Ошибку советов не показываем поверх подъёма — без них страница работает.
  const [advice, setAdvice] = useState<PriceAdvice[] | null>(null);

  const loadRobot = useCallback(() => {
    if (!isAdmin) return;
    fetchOverview(marketplace, user?.id)
      .then((d) => setAdvice(d.items || []))
      .catch(() => setAdvice([]));
    fetchRobotStatus(marketplace, user?.id)
      .then(setRobot)
      .catch((e) => {
        setRobot({ catalog: [], pendingLeft: 0, maxStepPercent: 3, runs: [] });
        toast({
          title: 'Не удалось загрузить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      });
  }, [isAdmin, marketplace, user?.id, toast]);

  useEffect(() => {
    setRobot(null);
    setAdvice(null);
    loadRobot();
  }, [loadRobot]);

  const raiseNow = async (
    step: number,
    note: string,
    itemIds: number[] | undefined,
    scope: string,
  ) => {
    setBusy(true);
    setMoveProgress(null);
    try {
      const r = await moveRobotPricesAll(
        marketplace,
        step,
        note,
        user?.id,
        itemIds,
        scope,
        (pushed, left) => setMoveProgress(`Отправлено ${pushed}, осталось ${left}`),
      );
      toast({
        title: 'Цены подняты',
        description: `Карточек изменено: ${r.pushed}. ${r.reason}`,
      });
      loadRobot();
    } catch (e) {
      toast({
        title: 'Не удалось поднять',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setMoveProgress(null);
    }
  };

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">
          Раздел доступен администратору.
        </p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold">Продвижение</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Поднимаем цены мелкими шагами. Можно взять весь ассортимент,
            одну ткань и ширину — или снять галочки у лишних карточек.
          </p>
        </div>

        <Tabs
          value={marketplace}
          onValueChange={(v) => setMarketplace(v as RobotMarketplace)}
        >
          <TabsList>
            {MARKETPLACES.map((m) => (
              <TabsTrigger key={m.code} value={m.code}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="space-y-4">
          <RobotTabPanel
            key={marketplace}
            robot={robot}
            advice={advice}
            busy={busy}
            onRaise={raiseNow}
            moveProgress={moveProgress}
          />
        </div>
      </div>
    </CrmLayout>
  );
};

export default PromotionPage;