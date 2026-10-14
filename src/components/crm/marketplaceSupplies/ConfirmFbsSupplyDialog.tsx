import { useEffect, useState } from 'react';
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
import type { SupplyType } from '@/lib/marketplaceSuppliesApi';

export interface PendingFbs {
  marketplace: string;
  type: SupplyType;
  /** Предупреждать, что поставка попадёт в задания смены (только кладовщику). */
  shiftWarning: boolean;
}

interface ConfirmFbsSupplyDialogProps {
  pendingFbs: PendingFbs | null;
  setPendingFbs: (v: PendingFbs | null) => void;
  onConfirm: (marketplace: string, type: SupplyType, isB2b: boolean) => void;
}

const KINDS = [
  {
    value: false,
    title: 'Обычная',
    text: 'Заказы покупателей — физлиц',
    icon: 'User',
  },
  {
    value: true,
    title: 'B2B — юрлица',
    text: 'Только заказы юридических лиц',
    icon: 'Building2',
  },
] as const;

/**
 * Создание поставки FBS.
 *
 * Для WB кладовщик сразу выбирает тип: обычная или B2B. WB не принимает поставку,
 * где заказы юрлиц смешаны с обычными, поэтому тип задаётся до первого скана, а
 * не угадывается по нему.
 */
const ConfirmFbsSupplyDialog = ({
  pendingFbs,
  setPendingFbs,
  onConfirm,
}: ConfirmFbsSupplyDialogProps) => {
  const [isB2b, setIsB2b] = useState(false);
  const askKind = pendingFbs?.marketplace === 'WB';

  useEffect(() => {
    if (pendingFbs) setIsB2b(false);
  }, [pendingFbs]);

  return (
    <AlertDialog open={!!pendingFbs} onOpenChange={(v) => !v && setPendingFbs(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {askKind ? 'Новая поставка WB FBS' : 'Поставка попадёт в задания смены'}
          </AlertDialogTitle>
          {pendingFbs?.shiftWarning && (
            <AlertDialogDescription>
              Поставка добавится в ваш список заданий на сегодня. Пока вы её не
              отгрузите, закрыть смену не получится — маркетплейс ждёт её сегодня.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {askKind && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Какую поставку собираете?</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {KINDS.map((k) => {
                const active = isB2b === k.value;
                return (
                  <button
                    key={String(k.value)}
                    type="button"
                    onClick={() => setIsB2b(k.value)}
                    className={`flex items-start gap-3 rounded-md border-2 p-3 text-left transition-colors ${
                      active
                        ? k.value
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                          : 'border-primary bg-primary/5 text-foreground'
                        : 'border-border bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    <Icon name={k.icon} size={22} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="block font-semibold">{k.title}</span>
                      <span className="block text-xs text-muted-foreground">{k.text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              WB не принимает поставку, где заказы юрлиц смешаны с обычными. В поставку
              пройдут только заказы выбранного типа.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className={askKind && isB2b ? 'bg-indigo-600 text-white hover:bg-indigo-700' : ''}
            onClick={() => {
              const p = pendingFbs;
              setPendingFbs(null);
              if (p) onConfirm(p.marketplace, p.type, askKind ? isB2b : false);
            }}
          >
            {askKind && isB2b ? 'Создать поставку B2B' : 'Создать поставку'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmFbsSupplyDialog;
