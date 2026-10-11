import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Shelf } from '@/lib/shelvesApi';
import type { Shop } from '@/lib/marketplaceItemsApi';
import { choiceClass } from './adminReceiveShared';

interface AdminReceiveSetupProps {
  shops: Shop[];
  shopId: string;
  onPickShop: (id: number) => void;
  shelves: Shelf[];
  shelfId: string;
  shelfName: string | undefined;
  changeShelf: boolean;
  onChangeShelf: () => void;
  onPickShelf: (id: string) => void;
  scan: string;
  onScanChange: (value: string) => void;
  onScan: () => Promise<void>;
  saving: boolean;
  scanning: boolean;
}

/** Магазин, полка и поле скана стикера. */
const AdminReceiveSetup = ({
  shops,
  shopId,
  onPickShop,
  shelves,
  shelfId,
  shelfName,
  changeShelf,
  onChangeShelf,
  onPickShelf,
  scan,
  onScanChange,
  onScan,
  saving,
  scanning,
}: AdminReceiveSetupProps) => (
  <>
    <div className="space-y-1.5">
      <Label>Магазин</Label>
      <div className="flex flex-wrap gap-2">
        {shops.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPickShop(s.id)}
            className={
              String(s.id) === shopId
                ? 'rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground'
                : choiceClass
            }
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>

    <div className="space-y-1.5">
      <Label>Полка</Label>
      {shelfId && shelfName && !changeShelf ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <span className="text-sm font-semibold">полка № {shelfName}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onChangeShelf}>
            Сменить
          </Button>
        </div>
      ) : (
        <Select value={shelfId} onValueChange={onPickShelf}>
          <SelectTrigger>
            <SelectValue placeholder="Укажите полку один раз — дальше она запомнится" />
          </SelectTrigger>
          <SelectContent>
            {shelves.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>

    <div className="space-y-1.5">
      <Label>Скан стикера</Label>
      <Input
        autoFocus
        placeholder="Любой наш стикер"
        value={scan}
        onChange={(e) => onScanChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onScan();
          }
        }}
        disabled={saving || scanning}
        className="font-mono-tech"
      />
      <p className="text-xs text-muted-foreground">
        {scanning
          ? 'Смотрим стикер…'
          : 'Подойдёт стикер товара, заказа или прослеживаемости. Вещь, которая уже на складе, второй раз не добавится'}
      </p>
    </div>
  </>
);

export default AdminReceiveSetup;
