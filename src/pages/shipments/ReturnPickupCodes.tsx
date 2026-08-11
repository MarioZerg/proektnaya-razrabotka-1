import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchReturnCodes,
  type OzonPvzPlace,
  saveReturnCode,
  refreshReturnCode,
  fetchPickupList,
  fetchGiveoutProgress,
  type ReturnPickupCode,
  type ReturnGiveout,
  type GiveoutProgress,
} from '@/lib/returnCodesApi';
import ReturnCodeCard from '@/components/crm/returnCodes/ReturnCodeCard';
import GiveoutList from '@/components/crm/returnCodes/GiveoutList';
import GiveoutProgressDialog from '@/components/crm/returnCodes/GiveoutProgressDialog';
import ReturnCodeDialogs from '@/components/crm/returnCodes/ReturnCodeDialogs';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/**
 * Штрихкоды для получения возвратов в пунктах выдачи.
 *
 * На ПВЗ возвраты не отдают без штрихкода кабинета продавца — у каждой площадки он свой
 * и постоянный. Раньше код искали в переписке или возили распечаткой; здесь он открывается
 * с телефона на весь экран, чтобы приёмщик сразу отсканировал.
 *
 * Заполняет коды администратор, кладовщик только показывает.
 */
const ReturnPickupCodes = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canView = isAdmin || isStorekeeperRole(user?.role);

  const [items, setItems] = useState<ReturnPickupCode[]>([]);
  const [totalWaiting, setTotalWaiting] = useState(0);
  /** По каким пунктам выдачи разложены ждущие вещи OZON — кладовщику нужно знать, куда ехать. */
  const [ozonPlaces, setOzonPlaces] = useState<OzonPvzPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<ReturnPickupCode | null>(null);
  const [editing, setEditing] = useState<ReturnPickupCode | null>(null);
  const [codeValue, setCodeValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  // Автообновление делаем один раз за визит: если маркетплейс ответил ошибкой,
  // повторные попытки не должны зациклиться.
  const autoTried = useRef(false);
  const [giveouts, setGiveouts] = useState<ReturnGiveout[]>([]);
  const [listLoading, setListLoading] = useState(true);
  // Отправление, приёмку которого сейчас смотрим вживую.
  const [progress, setProgress] = useState<GiveoutProgress | null>(null);
  const [watchingId, setWatchingId] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = () => {
    setLoading(true);
    fetchReturnCodes()
      .then((d) => {
        setItems(d.items);
        setTotalWaiting(d.totalWaiting);
        setOzonPlaces(d.ozonPlaces);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Что лежит на складах OZON и что уже собрано к выдаче.
  const loadGiveouts = () => {
    fetchPickupList()
      .then((d) => setGiveouts(d.giveouts))
      .catch(() => setGiveouts([]))
      .finally(() => setListLoading(false));
  };

  useEffect(loadGiveouts, []);

  // Пока идёт приёмка, сотрудник ПВЗ сканирует коробки — опрашиваем OZON каждые
  // 5 секунд, чтобы счётчик на телефоне кладовщика рос в реальном времени.
  useEffect(() => {
    if (!watchingId) return;
    let stop = false;
    const tick = () => {
      fetchGiveoutProgress(watchingId)
        .then((d) => {
          if (!stop) setProgress(d);
        })
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [watchingId]);

  // Код OZON приходит из личного кабинета и меняется — если сегодня его ещё не
  // забирали, подтягиваем свежий сами. Кладовщик открывает раздел и сразу видит
  // актуальный штрихкод, ничего не нажимая.
  useEffect(() => {
    if (loading) return;
    if (autoTried.current) return;
    const stale = items.find((i) => i.dailyRefresh && !i.updatedToday);
    if (stale) {
      autoTried.current = true;
      handleRefresh(stale, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items]);

  // Рисуем код при открытии: QR для площадок, где он нужен, иначе обычный штрихкод.
  useEffect(() => {
    // Если маркетплейс прислал готовую картинку — рисовать самим не нужно.
    if (shown?.codeImage) return;
    if (!shown?.code || !canvasRef.current) return;
    const canvas = canvasRef.current;
    if (shown.codeType === 'QR') {
      QRCode.toCanvas(canvas, shown.code, { width: 280, margin: 1 });
    } else {
      JsBarcode(canvas, shown.code, {
        format: shown.codeType === 'EAN13' ? 'EAN13' : 'CODE128',
        width: 3,
        height: 120,
        displayValue: true,
        fontSize: 18,
        margin: 8,
      });
    }
  }, [shown]);

  // Свежий код из личного кабинета. Кнопка доступна и кладовщику: код OZON живёт сутки,
  // и перед выездом на пункт выдачи человек должен получить актуальный сам.
  const handleRefresh = async (item: ReturnPickupCode, silent = false) => {
    setRefreshingId(item.marketplaceCode);
    try {
      // Тихое автообновление только читает код, ручное — выпускает новый.
      await refreshReturnCode(item.marketplaceCode, user?.id, silent);
      if (!silent) toast({ title: 'Код обновлён' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось обновить код',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await saveReturnCode({
        marketplaceCode: editing.marketplaceCode,
        code: codeValue.trim(),
        codeType: editing.codeType,
        actorId: user?.id,
      });
      toast({ title: 'Код сохранён' });
      setEditing(null);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен складу и администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Коды для получения возвратов</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Покажите код приёмщику на пункте выдачи — без него возвраты не отдадут
          </p>
        </div>

        {/* Общий счётчик: сразу видно, есть ли смысл ехать на пункты выдачи. */}
        {totalWaiting > 0 && (
          <Card className="border-amber-300 bg-amber-50 shadow-none">
            <CardContent className="flex items-center gap-3 py-4">
              <Icon name="PackageCheck" size={28} className="shrink-0 text-amber-600" />
              <div>
                <p className="text-lg font-bold text-amber-900">
                  Ждёт на ПВЗ: {totalWaiting} шт.
                </p>
                <p className="text-sm text-amber-900">
                  Возвраты доехали до пункта выдачи и ждут вас — это же число видно
                  в кабинете продавца
                </p>
                {/* Куда именно ехать: без адреса счётчик бесполезен, если пунктов несколько. */}
                {ozonPlaces.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ozonPlaces.map((p) => (
                      <span
                        key={p.name}
                        className="rounded-full bg-amber-200/70 px-3 py-1 text-xs font-medium text-amber-900"
                      >
                        {p.name} — {p.count} шт.
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <ReturnCodeCard
                key={item.marketplaceCode}
                item={item}
                isAdmin={isAdmin}
                refreshingId={refreshingId}
                onShow={setShown}
                onRefresh={handleRefresh}
                onEdit={(it) => {
                  setEditing(it);
                  setCodeValue(it.code || '');
                }}
              />
            ))}
          </div>
        )}

        <GiveoutList
          giveouts={giveouts}
          listLoading={listLoading}
          onWatch={setWatchingId}
        />

        <GiveoutProgressDialog
          watchingId={watchingId}
          progress={progress}
          onOpenChange={(open) => {
            if (!open) {
              setWatchingId(null);
              setProgress(null);
              loadGiveouts();
            }
          }}
        />

        <ReturnCodeDialogs
          shown={shown}
          setShown={setShown}
          canvasRef={canvasRef}
          editing={editing}
          setEditing={setEditing}
          codeValue={codeValue}
          setCodeValue={setCodeValue}
          saving={saving}
          onSave={handleSave}
        />
      </div>
    </CrmLayout>
  );
};

export default ReturnPickupCodes;
