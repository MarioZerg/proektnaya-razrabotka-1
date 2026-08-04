import { Button } from '@/components/ui/button';
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
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import type { MarketplaceItem } from '@/lib/marketplaceItemsApi';

interface ItemsGridProps {
  loading: boolean;
  items: MarketplaceItem[];
  filteredItems: MarketplaceItem[];
  pagedItems: MarketplaceItem[];
  currentPage: number;
  totalPages: number;
  setPage: (updater: (p: number) => number) => void;
  onEdit: (item: MarketplaceItem) => void;
  deleteId: number | null;
  setDeleteId: (id: number | null) => void;
  onDelete: () => void;
}

const ItemsGrid = ({
  loading,
  items,
  filteredItems,
  pagedItems,
  currentPage,
  totalPages,
  setPage,
  onEdit,
  deleteId,
  setDeleteId,
  onDelete,
}: ItemsGridProps) => {
  const { toast } = useToast();

  // Копирует код OZON (OZN + ozon_sku) в буфер — им товар добавляют в поставку FBO.
  // navigator.clipboard доступен только на HTTPS/localhost, поэтому есть запасной способ
  // через скрытое поле и execCommand — работает и без защищённого контекста.
  const copyOzonCode = async (ozonSku: string) => {
    const code = `OZN${ozonSku}`;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      }
    } catch {
      ok = false;
    }
    if (ok) {
      toast({ title: 'Код скопирован', description: code });
    } else {
      toast({ title: 'Не удалось скопировать', description: code, variant: 'destructive' });
    }
  };

  return (
    <>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Товаров пока нет — добавьте первый.</p>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ничего не найдено по заданным фильтрам.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pagedItems.map((item) => (
              <Card key={item.id} className="border-border shadow-none">
                <CardContent className="space-y-2 pt-6">
                  <div className="flex items-start justify-between">
                    <p className="font-medium">{item.name}</p>
                    <div className="flex gap-1">
                      <Button size="icon" variant="secondary" onClick={() => onEdit(item)}>
                        <Icon name="Pencil" size={14} />
                      </Button>
                      <Button size="icon" variant="destructive" onClick={() => setDeleteId(item.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.article && (
                      <Badge variant="secondary" className="font-mono-tech">
                        {item.article}
                      </Badge>
                    )}
                    {item.material && <Badge variant="outline">{item.material}</Badge>}
                    {item.ozonSku && (
                      <Badge
                        role="button"
                        tabIndex={0}
                        onClick={() => copyOzonCode(item.ozonSku!)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') copyOzonCode(item.ozonSku!);
                        }}
                        className="cursor-pointer gap-1 bg-blue-600 font-mono-tech text-white hover:bg-blue-700"
                        title="Скопировать код для поставки FBO"
                      >
                        OZN{item.ozonSku}
                        <Icon name="Copy" size={11} />
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                  </div>
                  {(item.wbSku || item.barcode) && (
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.wbSku && <span>WB: {item.wbSku}</span>}
                      {item.barcode && <span>Баркод: {item.barcode}</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                size="icon"
                variant="outline"
                disabled={currentPage === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <Icon name="ChevronLeft" size={16} />
              </Button>
              <span className="px-3 text-sm text-muted-foreground">
                {currentPage} / {totalPages}
              </span>
              <Button
                size="icon"
                variant="outline"
                disabled={currentPage === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <Icon name="ChevronRight" size={16} />
              </Button>
            </div>
          )}
        </>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Вы уверены, что хотите удалить товар?</AlertDialogTitle>
            <AlertDialogDescription>
              Действие нельзя отменить. Если по товару уже есть заказы в системе — удаление
              будет заблокировано.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ItemsGrid;