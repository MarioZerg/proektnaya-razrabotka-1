import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { printRepairSticker } from '@/lib/printRepairSticker';
import {
  fetchRepairReasons,
  sendToRepair,
  type RepairReason,
} from '@/lib/repairFabricApi';

interface KioskSendToRepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещь, которая уходит в перешив. */
  goodsWarehouseId?: number;
  /** Что за вещь — показываем упаковщице, чтобы она сверила перед отправкой. */
  material?: string | null;
  width?: number | null;
  height?: number | null;
  orderNumber?: string | null;
  /** Вещь ушла в материал — экран перепаковки должен её отпустить. */
  onSent?: () => void;
}

/**
 * Отправка годного куска в перешив: причина → стикер → цех.
 *
 * ПОЧЕМУ БОЛЬШЕ НЕ НУЖЕН РУЛОН. Раньше упаковщица искала подходящий рулон,
 * сканировала его, и кусок растворялся в метраже: рулон просто прибавлял себе
 * несколько метров. Кусок терял размеры и переставал существовать как вещь —
 * закройщик видел обезличенные метры и не мог найти нужный отрез.
 *
 * ЗАЧЕМ ПРИЧИНА. До неё кусок приезжал к закройщице безымянным: «Вуаль
 * 300×255», и всё. Чтобы понять, что с ним не так, она разворачивала весь
 * отрез на столе и искала брак глазами — дырку размером с ноготь можно искать
 * минутами. А найти её нужно ДО раскроя, иначе брак уедет в готовую вещь
 * второй раз. Теперь одно нажатие упаковщицы экономит этот поиск: «дырка на
 * ткани» — смотреть полотно, «кривой шов» — ткань целая, кроить смело.
 *
 * ЗАЧЕМ СТИКЕР. В цехе на стеллаже лежит стопка одинаковых с виду отрезов.
 * Номер RS-XXXXXX печатается на наклейке и стоит в карточке заказа: закройщица
 * берёт нужный кусок с первого раза, не трогая соседние.
 *
 * Размеры берутся из заказа, руками ничего не вводится: промахнуться цифрой
 * и создать кусок, которого нет, невозможно.
 */
const KioskSendToRepairDialog = ({
  open,
  onOpenChange,
  goodsWarehouseId,
  material,
  width,
  height,
  orderNumber,
  onSent,
}: KioskSendToRepairDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [reasons, setReasons] = useState<RepairReason[]>([]);
  const [chosen, setChosen] = useState<RepairReason | null>(null);
  /** Своя формулировка — нужна только для «Другое». */
  const [customReason, setCustomReason] = useState('');

  useEffect(() => {
    fetchRepairReasons()
      .then((r) => setReasons(r.reasons))
      .catch(() => setReasons([]));
  }, []);

  // Каждая вещь — свой разбор. Причина от предыдущей не должна переноситься:
  // иначе упаковщица на потоке отправит три куска с одной и той же пометкой.
  useEffect(() => {
    if (!open) {
      setChosen(null);
      setCustomReason('');
    }
  }, [open]);

  /** Группируем в том порядке, в каком причины пришли с сервера. */
  const groups = useMemo(() => {
    const out: Array<{ name: string; items: RepairReason[] }> = [];
    for (const r of reasons) {
      const g = out.find((x) => x.name === r.group);
      if (g) g.items.push(r);
      else out.push({ name: r.group, items: [r] });
    }
    return out;
  }, [reasons]);

  const needsCustom = chosen?.code === 'other';
  const canSend =
    !!goodsWarehouseId && !!chosen && (!needsCustom || customReason.trim().length > 0);

  const handleSend = async () => {
    if (!goodsWarehouseId || !chosen) return;
    setSaving(true);
    try {
      const r = await sendToRepair(
        goodsWarehouseId,
        needsCustom
          ? { label: customReason.trim() }
          : { code: chosen.code, label: chosen.label },
        { id: user?.id, name: user?.name },
      );

      // СНАЧАЛА ЗАКРЫВАЕМ ОКНО, ПЕЧАТАЕМ ПОСЛЕ — ИНАЧЕ ТЕРМИНАЛ ЗАВИСАЕТ.
      //
      // Печать идёт в скрытом iframe: он забирает фокус себе и вызывает
      // window.print(), который ОСТАНАВЛИВАЕТ страницу до закрытия диалога
      // печати. А это окно — модальное: оно держит фокус-ловушку и пытается
      // вернуть фокус обратно. Два механизма тянут фокус друг у друга, и
      // терминал замирает с открытым окном причин: кнопки не нажимаются,
      // упаковщице остаётся только перезагружать планшет.
      //
      // Поэтому порядок строгий: закрыли окно, отпустили вещь, и только
      // потом, следующим кадром, отправили стикер на принтер. К этому моменту
      // ловушки фокуса уже нет и забирать его некому.
      onOpenChange(false);
      onSent?.();
      setSaving(false);

      toast({
        title: `Отправлено в перешив · ${r.barcode}`,
        description: `${r.reasonLabel}. Наклейте стикер на вещь — закройщик найдёт её по номеру`,
      });

      // 300 мс — время закрытия окна. Печатать раньше нельзя: окно ещё в DOM
      // и фокус-ловушка жива.
      setTimeout(() => {
        printRepairSticker({
          barcode: r.barcode,
          material: r.material,
          width: r.width,
          height: r.height,
          reason: r.reasonLabel,
          orderNumber: r.orderNumber || orderNumber,
        });
      }, 300);
      return;
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kiosk-root max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Отправить в перешив?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Показываем размеры крупно: упаковщица сверяет их с куском в руках
              до отправки, а не после. */}
          <div className="rounded-xl border-2 border-violet-300 bg-violet-50 p-4 text-center">
            <p className="text-lg text-violet-900">{material || 'Материал не указан'}</p>
            <p className="text-4xl font-bold text-violet-900">
              {width && height ? `${width} × ${height}` : '—'}
            </p>
            <p className="mt-1 text-base text-violet-800">сантиметров</p>
          </div>

          {/* ПРИЧИНА — ОБЯЗАТЕЛЬНЫЙ ШАГ, А НЕ ГАЛОЧКА ДЛЯ ОТЧЁТА.
              Она попадёт на стикер и в карточку заказа: именно по ней
              закройщица поймёт, где искать брак, не разворачивая отрез. */}
          <div className="space-y-3">
            <p className="text-lg font-semibold">
              Что с вещью не так?
              <span className="ml-2 text-base font-normal text-muted-foreground">
                закройщик увидит это на стикере
              </span>
            </p>

            {groups.length === 0 ? (
              <p className="flex items-center gap-2 text-base text-muted-foreground">
                <Icon name="Loader2" size={18} className="animate-spin" />
                Загружаем причины…
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.name} className="space-y-2">
                  <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {g.name}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {g.items.map((r) => {
                      const active = chosen?.code === r.code;
                      return (
                        <button
                          key={r.code}
                          type="button"
                          onClick={() => setChosen(r)}
                          disabled={saving}
                          className={`min-h-14 rounded-xl border-2 px-3 py-2 text-left text-base font-medium transition ${
                            active
                              ? 'border-violet-600 bg-violet-600 text-white'
                              : 'border-border bg-white hover:border-violet-400'
                          }`}
                        >
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            {/* «Другое» без расшифровки бесполезно — это та же безымянная вещь,
                от которой мы уходим. Поэтому текст обязателен. */}
            {needsCustom && (
              <Input
                autoFocus
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Напишите, что именно не так"
                className="h-14 text-lg"
                maxLength={200}
                disabled={saving}
              />
            )}
          </div>

          <p className="text-base text-muted-foreground">
            Кусок уйдёт закройщикам в цех со своими размерами. Рулон указывать не
            нужно. После отправки напечатается стикер — наклейте его на вещь
          </p>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-16 flex-1 text-lg"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              className="h-16 flex-1 bg-violet-600 text-lg text-white hover:bg-violet-700"
              onClick={handleSend}
              disabled={saving || !canSend}
            >
              <Icon
                name={saving ? 'Loader2' : 'Printer'}
                size={20}
                className={`mr-2 ${saving ? 'animate-spin' : ''}`}
              />
              {saving ? 'Отправляем…' : 'В перешив и печать'}
            </Button>
          </div>

          {/* Пока причина не выбрана, кнопка неактивна — говорим почему,
              иначе упаковщица жмёт её и не понимает, что не работает. */}
          {!chosen && (
            <p className="text-center text-base text-amber-700">
              Выберите причину — без неё отправить нельзя
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskSendToRepairDialog;