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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { goodsStatusLabel } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

interface BoxItemRowProps {
  title: string;
  goodsStatus: string;
  /** Позиции короба, из которых состоит эта строка. */
  itemIds: number[];
  canEdit: boolean;
  /** Убрать указанное число штук этого товара. */
  onRemoveCount: (itemIds: number[], count: number) => Promise<void> | void;
}

/**
 * Строка товара в коробе с РЕДАКТИРУЕМЫМ количеством.
 *
 * Одинаковые вещи в коробе схлопнуты в строку «12 × Лен 300x255». Поправить
 * число было нечем: крестик убирал ровно одну вещь, и чтобы из 12 сделать 8,
 * кладовщик жал его четыре раза подряд, каждый раз ожидая перезагрузку короба.
 * Промахнулся — набирай заново сканером.
 *
 * Здесь количество правится прямо в строке: минусом по штуке или вводом числа
 * с клавиатуры. Уйдут ПОСЛЕДНИЕ добавленные вещи — кладовщик только что
 * переложил лишнее, значит убрать надо именно это.
 *
 * УВЕЛИЧИТЬ КОЛИЧЕСТВО ОТСЮДА НЕЛЬЗЯ, и это намеренно: добавить вещь в короб
 * можно только сканированием её ярлыка. Иначе система спишет со склада
 * случайную вещь и разойдётся с тем, что реально лежит на полке.
 */
const BoxItemRow = ({
  title,
  goodsStatus,
  itemIds,
  canEdit,
  onRemoveCount,
}: BoxItemRowProps) => {
  const count = itemIds.length;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(count));
  const [busy, setBusy] = useState(false);

  // Короб перезагрузился (кто-то пикнул ещё) — подтягиваем актуальное число,
  // пока кладовщик не начал править вручную.
  useEffect(() => {
    if (!editing) setDraft(String(count));
  }, [count, editing]);

  // СПРАШИВАЕМ ПОДТВЕРЖДЕНИЕ ПЕРЕД КАЖДЫМ УБАВЛЕНИЕМ.
  //
  // Кнопки стоят вплотную к количеству, а работают в перчатках и в спешке:
  // случайное нажатие молча выбрасывало вещь из короба и возвращало её на
  // склад. Заметить это можно было только при сверке с заявкой — то есть
  // в самом конце, когда короба уже заклеены.
  //
  // Поэтому держим намерение в pending и выполняем только после явного «да».
  const [pending, setPending] = useState<number | null>(null);

  const apply = async (next: number) => {
    const target = Math.max(0, Math.min(count, Math.trunc(next)));
    if (target === count) {
      setEditing(false);
      setDraft(String(count));
      return;
    }
    setPending(target);
  };

  const confirm = async () => {
    if (pending === null) return;
    const target = pending;
    setPending(null);
    setBusy(true);
    try {
      await onRemoveCount(itemIds, count - target);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  // Сколько уйдёт со склада, если подтвердить.
  const removing = pending === null ? 0 : count - pending;

  const commitDraft = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(count));
      setEditing(false);
      return;
    }
    apply(parsed);
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        {/* Количество слева и крупно: кладовщик сверяет короб с заявкой по
            числу штук каждого размера, а не по номерам складских записей. */}
        {editing ? (
          <Input
            autoFocus
            type="number"
            inputMode="numeric"
            min={0}
            max={count}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
              if (e.key === 'Escape') {
                setDraft(String(count));
                setEditing(false);
              }
            }}
            className="h-8 w-16 shrink-0 text-center font-bold"
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit || busy}
            onClick={() => canEdit && setEditing(true)}
            title={canEdit ? 'Нажмите, чтобы указать количество' : undefined}
            className={`shrink-0 rounded-md bg-primary px-2 py-1 font-bold text-primary-foreground ${
              canEdit ? 'hover:bg-primary/85' : 'cursor-default'
            }`}
          >
            {busy ? <Icon name="Loader2" size={14} className="animate-spin" /> : count}
          </button>
        )}
        {/* Артикул — сам по себе, без подписи под ним: строка читается одним
            взглядом, как в заявке. */}
        <p className="min-w-0 truncate font-medium">{title}</p>
      </div>

      {/* ВСЁ СЛУЖЕБНОЕ — ВИДЖЕТАМИ СПРАВА.
          Статус стоял серой строкой ПОД артикулом и ломал ритм списка: глаз
          цеплялся за него вместо размера, и короб из двадцати позиций читался
          вдвое дольше. Справа статусы выстраиваются в ровную колонку — сразу
          видно, где строка в норме, а где выбивается. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant="outline" className="font-normal">
          {goodsStatusLabel(goodsStatus)}
        </Badge>

        {canEdit && !editing && (
          <>
            {/* Минус — убрать одну штуку. Самый частый случай: пикнул лишнюю
                и сразу поправил, не заходя в ввод числа. */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={busy}
              title="Убрать одну штуку"
              onClick={() => apply(count - 1)}
            >
              <Icon name="Minus" size={14} />
            </Button>
            {/* Крестик — убрать весь размер целиком. */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              disabled={busy}
              title={count > 1 ? `Убрать все ${count} шт.` : 'Убрать из короба'}
              onClick={() => apply(0)}
            >
              <Icon name="X" size={14} />
            </Button>
          </>
        )}
      </div>

      {/* Подтверждение убавления. Показываем ИМЕННО ТО, что произойдёт:
          сколько штук уйдёт, какого размера и сколько останется — чтобы
          кладовщик проверил себя, а не жал «да» вслепую. */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(v) => !v && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === 0
                ? `Убрать «${title}» из короба?`
                : `Убрать ${removing} шт. из короба?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <b>{title}</b>
                </p>
                <p>
                  Сейчас в коробе <b>{count}</b> шт.
                  {pending === 0
                    ? ' Уйдут все — строка исчезнет.'
                    : ` Останется ${pending}.`}
                </p>
                <p className="text-muted-foreground">
                  Товар вернётся на склад и снова будет доступен к сканированию.
                  Чтобы положить обратно в короб, его нужно отсканировать заново.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Да, убрать {removing} шт.
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BoxItemRow;