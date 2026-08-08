import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchReturnCodes,
  saveReturnCode,
  refreshReturnCode,
  type ReturnPickupCode,
} from '@/lib/returnCodesApi';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/** Цвет плитки под фирменный цвет площадки — так кладовщик находит нужную не читая. */
const tileClass: Record<string, string> = {
  ozon: 'bg-blue-600 hover:bg-blue-700',
  wildberries: 'bg-purple-600 hover:bg-purple-700',
  yandex_market: 'bg-yellow-500 hover:bg-yellow-600',
};

const iconByMarketplace: Record<string, string> = {
  ozon: 'ShoppingBag',
  wildberries: 'ShoppingCart',
  yandex_market: 'Store',
};

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
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState<ReturnPickupCode | null>(null);
  const [editing, setEditing] = useState<ReturnPickupCode | null>(null);
  const [codeValue, setCodeValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const load = () => {
    setLoading(true);
    fetchReturnCodes()
      .then((d) => {
        setItems(d.items);
        setTotalWaiting(d.totalWaiting);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Рисуем код при открытии: QR для площадок, где он нужен, иначе обычный штрихкод.
  useEffect(() => {
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
  const handleRefresh = async (item: ReturnPickupCode) => {
    setRefreshingId(item.marketplaceCode);
    try {
      await refreshReturnCode(item.marketplaceCode, user?.id);
      toast({ title: 'Код обновлён' });
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
                  Возвраты одобрены и готовы к выдаче — заберите их с пунктов выдачи
                </p>
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
              <Card key={item.marketplaceCode} className="border-border shadow-none">
                <CardContent className="space-y-3 pt-6">
                  <button
                    type="button"
                    disabled={!item.code}
                    onClick={() => setShown(item)}
                    className={`flex h-28 w-full flex-col items-center justify-center gap-2 rounded-lg text-white ${
                      item.code
                        ? tileClass[item.marketplaceCode] || 'bg-primary hover:bg-primary/90'
                        : 'cursor-not-allowed bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon
                      name={iconByMarketplace[item.marketplaceCode] || 'Package'}
                      size={32}
                    />
                    <span className="text-lg font-bold">{item.title}</span>
                  </button>

                  {/* Сколько посылок ждёт именно на этой площадке. */}
                  <p
                    className={`text-center text-sm font-medium ${
                      item.waitingCount > 0 ? 'text-amber-600' : 'text-muted-foreground'
                    }`}
                  >
                    {item.waitingCount > 0
                      ? `Ждёт к забору: ${item.waitingCount} шт.`
                      : 'Нет возвратов к забору'}
                  </p>

                  {item.code ? (
                    <>
                      <p className="text-center font-mono-tech text-sm text-muted-foreground">
                        {item.code}
                      </p>
                      {/* У OZON код меняется каждый день: вчерашний на ПВЗ не примут,
                          поэтому прямо предупреждаем, что нужно обновить. */}
                      {item.dailyRefresh && !item.updatedToday && (
                        <p className="rounded bg-destructive/10 px-2 py-1 text-center text-sm font-medium text-destructive">
                          Код устарел — обновите его сегодня
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-center text-sm text-amber-600">
                      Код не заполнен — возврат не получить
                    </p>
                  )}


                  {/* Обновление по API — только там, где код меняется ежедневно. */}
                  {item.dailyRefresh && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => handleRefresh(item)}
                      disabled={refreshingId === item.marketplaceCode}
                    >
                      <Icon
                        name={refreshingId === item.marketplaceCode ? 'Loader2' : 'RefreshCw'}
                        size={14}
                        className={`mr-1 ${refreshingId === item.marketplaceCode ? 'animate-spin' : ''}`}
                      />
                      Обновить код
                    </Button>
                  )}

                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setEditing(item);
                        setCodeValue(item.code || '');
                      }}
                    >
                      <Icon name="Pencil" size={14} className="mr-1" />
                      {item.code ? 'Изменить код' : 'Задать код'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Код во весь экран: приёмщик на ПВЗ сканирует его прямо с телефона. */}
        <Dialog open={!!shown} onOpenChange={(open) => !open && setShown(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{shown?.title}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-4">
              <canvas ref={canvasRef} />
              <p className="font-mono-tech text-lg font-bold">{shown?.code}</p>
              <p className="text-center text-sm text-muted-foreground">
                Покажите этот код приёмщику на пункте выдачи
              </p>
              {shown?.dailyRefresh && !shown?.updatedToday && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm font-medium text-destructive">
                  Код обновляется раз в сутки, а этот сохранён не сегодня — возьмите
                  свежий в личном кабинете, иначе возврат не выдадут
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Код возвратов · {editing?.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Штрихкод из личного кабинета</Label>
                <Input
                  value={codeValue}
                  onChange={(e) => setCodeValue(e.target.value)}
                  placeholder="Например: 1234567890"
                />
                <p className="text-xs text-muted-foreground">
                  Код продавца — по нему на ПВЗ выдают все возвраты
                </p>
                {editing?.dailyRefresh && (
                  <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                    Этот код меняется каждый день — обновляйте его утром перед поездкой
                    на пункт выдачи
                  </p>
                )}
              </div>
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </CrmLayout>
  );
};

export default ReturnPickupCodes;
