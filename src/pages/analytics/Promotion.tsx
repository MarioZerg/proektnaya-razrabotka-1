import { useCallback, useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import PricePushConfirm from '@/components/crm/promotion/PricePushConfirm';
import RobotTabPanel from '@/components/crm/promotion/RobotTabPanel';
import AdviceTabPanel from '@/components/crm/promotion/AdviceTabPanel';
import {
  fetchRobotStatus,
  moveRobotPrices,
  runRobotNow,
  saveRobotSettings,
  type RobotStatus,
} from '@/lib/priceRobotApi';
import {
  decideAdvice,
  fetchOverview,
  pushPrices,
  saveStrategy,
  type MarketplaceCode,
  type OverviewResponse,
} from '@/lib/promotionApi';

const MARKETPLACES: { code: MarketplaceCode; label: string }[] = [
  { code: 'ozon', label: 'OZON' },
  { code: 'wildberries', label: 'Wildberries' },
  { code: 'yandex_market', label: 'Яндекс Маркет' },
];

/**
 * Продвижение: два способа вести цены к нужной марже.
 *
 * РОБОТ поднимает цены всего магазина сам, мелкими шагами с паузой, и
 * останавливается, когда маржа FBS дошла до цели. Если после подъёма продажи
 * просели — откатывает цену назад. Поднимать восемьсот карточек руками и
 * следить за спросом после каждого шага человек не может, машина может.
 *
 * СОВЕТЫ — точечная работа по конкретным товарам, с подтверждением владельца.
 *
 * Цену двигаем мелкими шагами. Резкий подъём выбрасывает товар из скидки
 * площадки (СПП) и из выдачи — потерять позицию легко, вернуть трудно.
 */
const PromotionPage = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [marketplace, setMarketplace] = useState<MarketplaceCode>('ozon');
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  const [marginMin, setMarginMin] = useState('10');
  const [marginMax, setMarginMax] = useState('15');
  const [stepPercent, setStepPercent] = useState('2');
  const [stepDays, setStepDays] = useState('7');
  const [showSettings, setShowSettings] = useState(false);

  // Робот: настройки, журнал шагов и текущая маржа FBS.
  const [robot, setRobot] = useState<RobotStatus | null>(null);

  const load = useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    setSelected(new Set());
    fetchOverview(marketplace, user?.id)
      .then((d) => {
        setData(d);
        setMarginMin(String(d.strategy.marginMin));
        setMarginMax(String(d.strategy.marginMax));
        setStepPercent(String(d.strategy.stepPercent));
        setStepDays(String(d.strategy.stepDays));
      })
      .catch((e) => toast({ title: 'Не удалось загрузить', description: e.message }))
      .finally(() => setLoading(false));
  }, [marketplace, isAdmin, user?.id, toast]);

  useEffect(() => load(), [load]);

  const loadRobot = useCallback(() => {
    if (!isAdmin) return;
    fetchRobotStatus(user?.id)
      .then(setRobot)
      .catch(() => setRobot(null));
  }, [isAdmin, user?.id]);

  useEffect(() => loadRobot(), [loadRobot]);

  const saveRobot = async () => {
    if (!robot?.settings) return;
    setBusy(true);
    try {
      await saveRobotSettings({ ...robot.settings, actorId: user?.id });
      toast({
        title: 'Настройки робота сохранены',
        description: robot.settings.dryRun
          ? 'Режим наблюдения: цены на витрине не изменятся'
          : 'Боевой режим: робот будет менять цены сам',
      });
      loadRobot();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Ручной сдвиг цен: двинуть прямо сейчас, вне расписания робота. */
  const moveNow = async (step: number, note: string) => {
    setBusy(true);
    try {
      const r = await moveRobotPrices(step, note, user?.id);
      toast({ title: 'Цены сдвинуты', description: r.reason });
      loadRobot();
    } catch (e) {
      toast({
        title: 'Не удалось сдвинуть',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Прогон вручную: посмотреть решение робота, не дожидаясь ночи. */
  const runRobot = async () => {
    setBusy(true);
    try {
      const r = await runRobotNow(user?.id);
      toast({ title: 'Робот отработал', description: r.reason });
      loadRobot();
    } catch (e) {
      toast({
        title: 'Не удалось запустить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (itemId: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const actionable = (data?.items || []).filter(
    (i) => i.action === 'raise' || i.action === 'lower' || i.action === 'rollback',
  );

  const toggleAll = () =>
    setSelected((s) =>
      s.size === actionable.length ? new Set() : new Set(actionable.map((i) => i.itemId)),
    );

  const decide = async (decision: 'applied' | 'skipped') => {
    const items = actionable
      .filter((i) => selected.has(i.itemId))
      .map((i) => ({ ...i, marketplaceCode: marketplace }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      await decideAdvice(items, decision, user?.id);
      toast({
        title: decision === 'applied' ? 'Отмечено как применённое' : 'Советы отклонены',
        description:
          decision === 'applied'
            ? `Позиций: ${items.length}. Не забудьте поменять цены в кабинете площадки`
            : `Позиций: ${items.length}`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const chosen = actionable.filter((i) => selected.has(i.itemId));

  /** Отправляет выбранные цены прямо на витрину площадки. */
  const handlePush = async () => {
    setBusy(true);
    try {
      const r = await pushPrices(
        marketplace,
        chosen.map((i) => ({ itemId: i.itemId, newPrice: i.suggestedPrice })),
        user?.id,
      );
      const problems = [...r.skipped, ...r.failed];
      toast({
        title: `Цены изменены: ${r.pushed}`,
        description: problems.length
          ? `Не отправлено ${problems.length}: ${problems[0].reason}`
          : 'Новые цены уже уходят на витрину',
        variant: r.pushed === 0 ? 'destructive' : undefined,
      });
      setPushOpen(false);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось изменить цены',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStrategy = async () => {
    setBusy(true);
    try {
      await saveStrategy({
        marginMin: Number(marginMin) || 10,
        marginMax: Number(marginMax) || 15,
        stepPercent: Number(stepPercent) || 2,
        stepDays: Number(stepDays) || 7,
        actorId: user?.id,
      });
      toast({ title: 'Правила сохранены', description: 'Советы пересчитаны' });
      load();
    } finally {
      setBusy(false);
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Продвижение</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ведём маржу к цели мелкими шагами, чтобы не потерять скидку
              площадки. Робот делает это сам, советы — точечно и с вашим
              подтверждением.
            </p>
          </div>
        </div>

        <Tabs defaultValue="robot" className="space-y-4">
          <TabsList>
            <TabsTrigger value="robot">Робот цен</TabsTrigger>
            <TabsTrigger value="advice">Советы по товарам</TabsTrigger>
          </TabsList>

          {/* РОБОТ: поднимает цены всего магазина сам и сам останавливается. */}
          <TabsContent value="robot" className="space-y-4">
            <RobotTabPanel
              robot={robot}
              busy={busy}
              onSettingsChange={(v) => robot && setRobot({ ...robot, settings: v })}
              onSave={saveRobot}
              onMove={moveNow}
              onRun={runRobot}
            />
          </TabsContent>

          <TabsContent value="advice" className="space-y-4">
            <AdviceTabPanel
              marketplaces={MARKETPLACES}
              marketplace={marketplace}
              setMarketplace={setMarketplace}
              data={data}
              selected={selected}
              loading={loading}
              busy={busy}
              showSettings={showSettings}
              onToggleSettings={() => setShowSettings((v) => !v)}
              onReload={load}
              marginMin={marginMin}
              marginMax={marginMax}
              stepPercent={stepPercent}
              stepDays={stepDays}
              setMarginMin={setMarginMin}
              setMarginMax={setMarginMax}
              setStepPercent={setStepPercent}
              setStepDays={setStepDays}
              onSaveStrategy={handleSaveStrategy}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onPushOpen={() => setPushOpen(true)}
              onDecide={decide}
            />
          </TabsContent>
        </Tabs>

        <PricePushConfirm
          open={pushOpen}
          onOpenChange={setPushOpen}
          items={chosen}
          marketplaceTitle={
            MARKETPLACES.find((m) => m.code === marketplace)?.label || ''
          }
          busy={busy}
          onConfirm={handlePush}
        />

      </div>
    </CrmLayout>
  );
};

export default PromotionPage;
