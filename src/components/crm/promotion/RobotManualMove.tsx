import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import RobotRaiseTable from '@/components/crm/promotion/RobotRaiseTable';
import {
  catalogTitle,
  chipClass,
  formatRub,
  raisedPrice,
} from '@/components/crm/promotion/raiseShared';
import type { CatalogItem } from '@/lib/priceRobotApi';

/**
 * Ручной подъём цен: ткань, размеры, конкретные карточки.
 *
 * Без списка владелец поднимал бы «всё подходящее» вслепую. Здесь фильтр
 * только сужает очередь, а галочки решают, какие строки реально поедут.
 */
interface Props {
  catalog: CatalogItem[];
  onRaise: (step: number, note: string, itemIds: number[] | undefined, scope: string) => void;
  busy: boolean;
  progress?: string | null;
  maxStep: number;
  pendingLeft: number;
}

const ANY = 'any';

const RobotManualMove = ({
  catalog,
  onRaise,
  busy,
  progress,
  maxStep,
  pendingLeft,
}: Props) => {
  const [step, setStep] = useState('1');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [materials, setMaterials] = useState<string[]>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const [heights, setHeights] = useState<number[]>([]);
  const [shopId, setShopId] = useState<number | null>(null);
  const [widthFrom, setWidthFrom] = useState(ANY);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const shops = useMemo(() => {
    const map = new Map<number, string>();
    catalog.forEach((i) => {
      if (i.shopId != null && i.shopName) map.set(i.shopId, i.shopName);
    });
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [catalog]);

  const materialOptions = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((i) => {
      if (i.material) set.add(i.material);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [catalog]);

  const widthOptions = useMemo(() => {
    const set = new Set<number>();
    catalog.forEach((i) => {
      if (i.width != null) set.add(i.width);
    });
    return [...set].sort((a, b) => a - b);
  }, [catalog]);

  const heightOptions = useMemo(() => {
    const set = new Set<number>();
    catalog.forEach((i) => {
      if (i.height != null) set.add(i.height);
    });
    return [...set].sort((a, b) => a - b);
  }, [catalog]);

  const toggleChip = (list: number[], value: number, set: (v: number[]) => void) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value].sort((a, b) => a - b));

  const toggleMaterial = (name: string) =>
    setMaterials((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );

  const matched = useMemo(() => {
    const from = widthFrom === ANY ? null : Number(widthFrom);
    return catalog.filter((i) => {
      if (shopId != null && i.shopId !== shopId) return false;
      if (materials.length && (!i.material || !materials.includes(i.material)))
        return false;
      if (widths.length && (i.width == null || !widths.includes(i.width)))
        return false;
      if (from != null && (i.width == null || i.width < from)) return false;
      if (heights.length && (i.height == null || !heights.includes(i.height)))
        return false;
      return true;
    });
  }, [catalog, shopId, materials, widths, widthFrom, heights]);

  // Поиск только прячет строки, выбор не сбрасываем: снятая галочка
  // не должна вернуться, потому что человек набрал в поле другое слово.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return matched;
    return matched.filter((i) => {
      const hay = `${catalogTitle(i)} ${i.name} ${i.sku || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [matched, search]);

  // Смена фильтра — новый набор карточек. Отмечаем все, иначе легко
  // поднять пустой выбор или наоборот старые id, которых уже нет на экране.
  const matchedIds = useMemo(() => matched.map((i) => i.itemId), [matched]);
  const matchedIdsKey = matchedIds.join(',');
  useEffect(() => {
    setSelected(new Set(matchedIdsKey ? matchedIdsKey.split(',').map(Number) : []));
  }, [matchedIdsKey]);

  const filtersOn =
    shopId != null ||
    materials.length > 0 ||
    widths.length > 0 ||
    heights.length > 0 ||
    widthFrom !== ANY;

  const scope = useMemo(() => {
    const parts: string[] = [];
    if (shopId != null) {
      const shop = shops.find((s) => s.id === shopId);
      if (shop) parts.push(shop.name);
    }
    if (materials.length) parts.push(materials.join(', '));
    if (widths.length) parts.push(`ширина ${widths.join(', ')}`);
    else if (widthFrom !== ANY) parts.push(`ширина от ${widthFrom}`);
    if (heights.length) parts.push(`высота ${heights.join(', ')}`);
    const picked = [...selected].filter((id) => matched.some((i) => i.itemId === id));
    if (picked.length !== matched.length) {
      parts.push(`${picked.length} из ${matched.length} карточек`);
    }
    return parts.length ? parts.join(', ') : 'весь ассортимент';
  }, [shopId, shops, materials, widths, widthFrom, heights, selected, matched]);

  const value = Number(step) || 0;
  const stepOk = value > 0 && value <= maxStep;
  const pending = pendingLeft > 0;
  const pickedItems = matched.filter((i) => selected.has(i.itemId));
  const disabled = busy || pending;

  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleVisible = () => {
    const ids = visible.map((i) => i.itemId);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const startRaise = () => {
    if (!stepOk || (!pending && pickedItems.length === 0)) return;
    if (pending) {
      onRaise(value, note, undefined, scope);
      return;
    }
    setConfirmOpen(true);
  };

  const confirmRaise = () => {
    setConfirmOpen(false);
    onRaise(
      value,
      note,
      pickedItems.map((i) => i.itemId),
      scope,
    );
  };

  const examples = pickedItems.slice(0, 5);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <h3 className="font-semibold">Поднять цены</h3>
          <p className="text-xs text-muted-foreground">
            Сузьте ткань и ширину, снимите лишние галочки. Без фильтра и
            снятий поднимется весь ассортимент площадки.
          </p>
        </div>

        {pending && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <Icon
              name="Loader2"
              size={16}
              className={`mt-0.5 shrink-0 text-amber-700 ${busy ? 'animate-spin' : ''}`}
            />
            <div>
              <p className="font-medium text-amber-900">
                Предыдущий подъём ещё отправляется: осталось {pendingLeft}
              </p>
              <p className="text-amber-800">
                Новый выбор начнётся, когда дойдут все карточки. Нажмите
                кнопку — досыл продолжится.
              </p>
            </div>
          </div>
        )}

        {shops.length > 1 && (
          <div className="space-y-1.5">
            <Label>Магазин</Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={chipClass(shopId == null)}
                onClick={() => setShopId(null)}
                disabled={disabled}
              >
                Все
              </button>
              {shops.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={chipClass(shopId === s.id)}
                  onClick={() => setShopId(s.id)}
                  disabled={disabled}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {materialOptions.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Ткань</Label>
              {materials.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setMaterials([])}
                  disabled={disabled}
                >
                  Сбросить
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {materialOptions.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={chipClass(materials.includes(name))}
                  onClick={() => toggleMaterial(name)}
                  disabled={disabled}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {widthOptions.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Ширина</Label>
              {widths.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setWidths([])}
                  disabled={disabled}
                >
                  Сбросить
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {widthOptions.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={chipClass(widths.includes(w))}
                  onClick={() => toggleChip(widths, w, setWidths)}
                  disabled={disabled}
                >
                  {w}
                </button>
              ))}
            </div>
            <div className="max-w-[180px] space-y-1">
              <Label className="text-xs font-normal text-muted-foreground">
                Или все от ширины
              </Label>
              <Select
                value={widthFrom}
                onValueChange={setWidthFrom}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Любая" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Любая</SelectItem>
                  {widthOptions.map((w) => (
                    <SelectItem key={`from-${w}`} value={String(w)}>
                      от {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {heightOptions.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Высота</Label>
              {heights.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setHeights([])}
                  disabled={disabled}
                >
                  Сбросить
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {heightOptions.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={chipClass(heights.includes(h))}
                  onClick={() => toggleChip(heights, h, setHeights)}
                  disabled={disabled}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Найти карточку</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Название, ткань или артикул"
            disabled={disabled}
          />
        </div>

        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          Выбрано{' '}
          <span className="font-semibold tabular-nums">{pickedItems.length}</span>
          {' '}из {matched.length}
          {visible.length !== matched.length ? ` (на экране ${visible.length})` : ''}
          {filtersOn ? ` — ${scope}` : ' — весь ассортимент'}
        </p>

        <RobotRaiseTable
          items={visible}
          selected={selected}
          onToggle={toggleOne}
          onToggleAll={toggleVisible}
          stepPercent={stepOk ? value : 0}
          disabled={disabled}
          showShop={shops.length > 1}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>На сколько, %</Label>
            <Input
              type="number"
              step="0.5"
              min={0.1}
              max={maxStep}
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className="w-[110px]"
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              Не больше {maxStep}% за раз
            </p>
          </div>
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label>Причина (в журнал)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: выровнять после акции"
              disabled={busy}
            />
          </div>
          <Button
            onClick={startRaise}
            disabled={busy || !stepOk || (!pending && pickedItems.length === 0)}
          >
            <Icon
              name={busy ? 'Loader2' : 'TrendingUp'}
              size={15}
              className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
            />
            {pending
              ? 'Продолжить отправку'
              : `Поднять ${pickedItems.length} на ${Math.abs(value) || 0}%`}
          </Button>
        </div>

        {busy && progress && (
          <p className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm font-medium">
            <Icon name="Loader2" size={15} className="animate-spin" />
            {progress}
          </p>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Поднять {pickedItems.length} карточек на {value}%?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left text-sm text-muted-foreground">
                <p>
                  Цены уйдут на витрину сразу. {scope}.
                  {note ? ` Причина: ${note}.` : ''}
                </p>
                <ul className="space-y-1">
                  {examples.map((i) => (
                    <li key={i.itemId} className="tabular-nums">
                      {catalogTitle(i)}:{' '}
                      {formatRub(i.price)} → {formatRub(raisedPrice(i.price, value))}
                    </li>
                  ))}
                </ul>
                {pickedItems.length > examples.length && (
                  <p>и ещё {pickedItems.length - examples.length}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRaise}>
              Поднять цены
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default RobotManualMove;
