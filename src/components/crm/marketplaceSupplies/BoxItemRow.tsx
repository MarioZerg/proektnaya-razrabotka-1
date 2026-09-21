import { useEffect, useState } from 'react';
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

  const apply = async (next: number) => {
    const target = Math.max(0, Math.min(count, Math.trunc(next)));
    if (target === count) {
      setEditing(false);
      setDraft(String(count));
      return;
    }
    setBusy(true);
    try {
      await onRemoveCount(itemIds, count - target);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

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
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {goodsStatusLabel(goodsStatus)}
          </p>
        </div>
      </div>

      {canEdit && !editing && (
        <div className="flex shrink-0 items-center gap-1">
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
        </div>
      )}
    </div>
  );
};

export default BoxItemRow;
