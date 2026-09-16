import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { chipClass } from '@/components/crm/promotion/raiseShared';

export const ANY = 'any';

/**
 * Фильтры очереди: магазин, ткань, ширина (чипы и «от»), высота, поиск.
 * Логика 1:1 перенесена из RobotManualMove.
 */
interface Props {
  shops: { id: number; name: string }[];
  materialOptions: string[];
  widthOptions: number[];
  heightOptions: number[];
  shopId: number | null;
  setShopId: (v: number | null) => void;
  materials: string[];
  setMaterials: (v: string[] | ((prev: string[]) => string[])) => void;
  widths: number[];
  setWidths: (v: number[]) => void;
  heights: number[];
  setHeights: (v: number[]) => void;
  widthFrom: string;
  setWidthFrom: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  disabled: boolean;
}

const RobotManualMoveFilters = ({
  shops,
  materialOptions,
  widthOptions,
  heightOptions,
  shopId,
  setShopId,
  materials,
  setMaterials,
  widths,
  setWidths,
  heights,
  setHeights,
  widthFrom,
  setWidthFrom,
  search,
  setSearch,
  disabled,
}: Props) => {
  const toggleChip = (list: number[], value: number, set: (v: number[]) => void) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value].sort((a, b) => a - b));

  const toggleMaterial = (name: string) =>
    setMaterials((prev: string[]) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );

  return (
    <>
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
    </>
  );
};

export default RobotManualMoveFilters;
