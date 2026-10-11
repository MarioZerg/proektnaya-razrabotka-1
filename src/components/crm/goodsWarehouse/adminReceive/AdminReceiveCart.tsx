import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import type { CartRow } from './adminReceiveShared';

interface AdminReceiveCartProps {
  cart: CartRow[];
  confirmed: boolean;
  saving: boolean;
  onRemove: (key: string) => void;
  onPrint: () => void;
  onConfirm: () => Promise<void>;
}

/** Корзина приёма: строки, затем «Подтвердить» или печать ленты. */
const AdminReceiveCart = ({ cart, confirmed, saving, onRemove, onPrint, onConfirm }: AdminReceiveCartProps) => (
  <div className="space-y-2">
    <Label>Корзина · {cart.length}</Label>
    <div className="max-h-[12.5rem] space-y-1 overflow-y-auto pr-1">
      {cart.map((row) => (
        <div
          key={row.key}
          className="flex h-9 items-center gap-2 rounded-md border border-border px-2"
        >
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</p>
          {row.storageBarcode && (
            <span className="shrink-0 font-mono-tech text-xs font-bold">{row.storageBarcode}</span>
          )}
          {!confirmed && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Убрать из корзины"
              onClick={() => onRemove(row.key)}
            >
              <Icon name="X" size={14} />
            </Button>
          )}
        </div>
      ))}
    </div>
    {confirmed ? (
      <Button className="w-full" size="lg" onClick={onPrint}>
        <Icon name="Printer" size={16} className="mr-2" />
        Лента стикеров
      </Button>
    ) : (
      <Button className="w-full" size="lg" onClick={() => void onConfirm()} disabled={saving}>
        {saving ? (
          <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
        ) : (
          <Icon name="PackagePlus" size={16} className="mr-2" />
        )}
        Подтвердить ({cart.length})
      </Button>
    )}
  </div>
);

export default AdminReceiveCart;
