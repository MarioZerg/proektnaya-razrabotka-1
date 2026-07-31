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
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                  </div>
                  {(item.ozonSku || item.wbSku || item.barcode) && (
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.ozonSku && <span>OZON: {item.ozonSku}</span>}
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
