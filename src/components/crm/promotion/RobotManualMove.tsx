import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import RobotRaiseTable from '@/components/crm/promotion/RobotRaiseTable';
import RobotManualMovePending from '@/components/crm/promotion/RobotManualMovePending';
import RobotManualMoveFilters, {
  ANY,
} from '@/components/crm/promotion/RobotManualMoveFilters';
import RobotManualMoveControls from '@/components/crm/promotion/RobotManualMoveControls';
import RobotManualMoveConfirm from '@/components/crm/promotion/RobotManualMoveConfirm';
import {
  catalogTitle,
  normalizeSearch,
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
    const q = normalizeSearch(search);
    if (!q) return matched;
    return matched.filter((i) => {
      const hay = normalizeSearch(
        `${catalogTitle(i)} ${i.name} ${i.sku || ''} ${i.material || ''} ${i.width ?? ''}x${i.height ?? ''}`,
      );
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
          <RobotManualMovePending pendingLeft={pendingLeft} busy={busy} />
        )}

        <RobotManualMoveFilters
          shops={shops}
          materialOptions={materialOptions}
          widthOptions={widthOptions}
          heightOptions={heightOptions}
          shopId={shopId}
          setShopId={setShopId}
          materials={materials}
          setMaterials={setMaterials}
          widths={widths}
          setWidths={setWidths}
          heights={heights}
          setHeights={setHeights}
          widthFrom={widthFrom}
          setWidthFrom={setWidthFrom}
          search={search}
          setSearch={setSearch}
          disabled={disabled}
        />

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

        <RobotManualMoveControls
          step={step}
          setStep={setStep}
          note={note}
          setNote={setNote}
          maxStep={maxStep}
          busy={busy}
          stepOk={stepOk}
          pending={pending}
          pickedCount={pickedItems.length}
          value={value}
          onStart={startRaise}
          progress={progress}
        />
      </CardContent>

      <RobotManualMoveConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        pickedItems={pickedItems}
        value={value}
        scope={scope}
        note={note}
        onConfirm={confirmRaise}
      />
    </Card>
  );
};

export default RobotManualMove;
