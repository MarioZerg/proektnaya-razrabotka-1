import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { setOzonAcceptedQty, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { formatDateTime } from '@/lib/dateUtils';

/** Состояния заявки OZON — по-русски, как в кабинете продавца. */
const OZON_STATE_RU: Record<string, string> = {
  DATA_FILLING: 'Заполнение данных',
  READY_TO_SUPPLY: 'Готова к отгрузке',
  ACCEPTED_AT_SUPPLY_WAREHOUSE: 'Принята на точке отгрузки',
  IN_TRANSIT: 'В пути',
  ACCEPTANCE_AT_STORAGE_WAREHOUSE: 'Приёмка на складе',
  REPORTS_CONFIRMATION_AWAITING: 'Согласование актов',
  REPORT_REJECTED: 'Спор по акту',
  COMPLETED: 'Завершена',
  REJECTED_AT_SUPPLY_WAREHOUSE: 'Отказано в приёмке',
  CANCELLED: 'Отменена',
  OVERDUE: 'Просрочена',
};

const FBS_CLOSE_HOURS = 12;
const FBO_CLOSE_HOURS = 24;

/** Через сколько закроется поставка: «через 5 ч 20 мин» или «в ближайший запуск». */
const closesIn = (from: string, hours: number, now: Date) => {
  const left = new Date(from).getTime() + hours * 3600_000 - now.getTime();
  if (left <= 0) return 'в ближайший запуск проверки';
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  return `через ${h > 0 ? `${h} ч ` : ''}${m} мин`;
};

interface SupplyAcceptanceCardProps {
  supply: SupplyDetail;
  now: Date;
  isManager: boolean;
  onReload: () => void;
}

/**
 * Итог поставки после отгрузки.
 *
 * FBS: всё отсканировано — «Отгружено», закроется сама через 12 часов.
 * Пропустили вещь — видно, сколько, и поставка сама не закроется.
 *
 * FBO OZON: статус заявки на OZON и сверка «отправили / приняли». OZON не
 * отдаёт принятое количество через API, поэтому число из акта приёмки
 * вносит менеджер — система сразу показывает расхождение.
 */
const SupplyAcceptanceCard = ({ supply, now, isManager, onReload }: SupplyAcceptanceCardProps) => {
  const { toast } = useToast();
  const [value, setValue] = useState(supply.ozonAcceptedQty?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(supply.ozonAcceptedQty?.toString() ?? '');
  }, [supply.ozonAcceptedQty]);

  const isFbs = supply.type === 'FBS';
  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  const afterShip = ['Отгрузка', 'Отгружено', 'Принята', 'Выполнена'].includes(supply.status);
  if (!afterShip || (!isFbs && !isOzonFbo)) return null;

  if (isFbs) {
    const missing = supply.fbsMissingCount ?? 0;
    if (supply.status === 'Отгружено' && supply.autoStatusAt) {
      return (
        <Card className="border-teal-300 bg-teal-50 shadow-none">
          <CardContent className="flex items-start gap-2 pt-6 text-sm text-teal-900">
            <Icon name="CircleCheck" size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">Отгружено — всё отсканировано</p>
              <p>
                Поставка закроется сама {closesIn(supply.autoStatusAt, FBS_CLOSE_HOURS, now)}.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
    if (supply.status === 'Отгрузка' && missing > 0) {
      return (
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="flex items-start gap-2 pt-6 text-sm">
            <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">
                Не отсканировано: {missing} шт.
              </p>
              <p className="text-muted-foreground">
                Эти вещи застикерованы, но в поставку не попали. Сама поставка не закроется —
                проверьте их и закройте вручную, когда разберётесь.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
    return null;
  }

  const sent = supply.sentQty ?? 0;
  const accepted = supply.ozonAcceptedQty;
  const diff = accepted != null ? accepted - sent : null;
  const stateText = supply.ozonState ? OZON_STATE_RU[supply.ozonState] || supply.ozonState : null;

  const save = async () => {
    const trimmed = value.trim();
    const qty = trimmed === '' ? null : Number(trimmed);
    if (qty != null && (!Number.isInteger(qty) || qty < 0)) {
      toast({ title: 'Укажите целое число штук', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await setOzonAcceptedQty(supply.id, qty);
      toast({ title: 'Принятое количество сохранено' });
      onReload();
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

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="Warehouse" size={18} className="text-muted-foreground" />
            <span className="font-semibold">Приёмка на складе OZON</span>
          </div>
          {stateText && (
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
              OZON: {stateText}
            </span>
          )}
        </div>

        {supply.status === 'Принята' && supply.autoStatusAt && (
          <p className="text-sm text-indigo-700">
            OZON закончил приёмку. Поставка закроется сама{' '}
            {closesIn(supply.autoStatusAt, FBO_CLOSE_HOURS, now)}.
          </p>
        )}
        {supply.status === 'Отгрузка' && (
          <p className="text-sm text-muted-foreground">
            Статус «Принята» появится сам, как только OZON закончит приёмку
            {supply.ozonCheckedAt ? ` (проверено ${formatDateTime(supply.ozonCheckedAt)})` : ''}.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">По заявке</p>
            <p className="text-lg font-semibold">{supply.totalQuantityMarketplace ?? '—'}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Отправили</p>
            <p className="text-lg font-semibold">
              {sent} шт.
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {supply.sentBoxes ?? 0} кор.
              </span>
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Принял OZON</p>
            <p className="text-lg font-semibold">{accepted != null ? `${accepted} шт.` : '—'}</p>
            {supply.ozonBoxesTotal != null && (
              <p className="text-xs text-muted-foreground">
                коробов обработано {supply.ozonBoxesAccepted ?? 0} из {supply.ozonBoxesTotal}
              </p>
            )}
          </div>
          <div
            className={`rounded-md border p-3 ${
              diff == null ? '' : diff === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-destructive/40 bg-destructive/5'
            }`}
          >
            <p className="text-xs text-muted-foreground">Расхождение</p>
            <p
              className={`text-lg font-semibold ${
                diff == null ? '' : diff === 0 ? 'text-emerald-700' : 'text-destructive'
              }`}
            >
              {diff == null ? '—' : diff === 0 ? 'Нет' : `${diff > 0 ? '+' : ''}${diff} шт.`}
            </p>
          </div>
        </div>

        {isManager && supply.status !== 'Открытая' && supply.status !== 'На сборке' && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <p className="mb-1 text-xs text-muted-foreground">
                Принято по акту приёмки OZON, шт. (из кабинета продавца)
              </p>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Например, 215"
              />
            </div>
            <Button onClick={save} disabled={saving}>
              <Icon name={saving ? 'Loader2' : 'Save'} size={14} className={saving ? 'mr-1.5 animate-spin' : 'mr-1.5'} />
              Сохранить
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplyAcceptanceCard;
