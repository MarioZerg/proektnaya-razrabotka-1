import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { saveShopItem, type ShopItem } from '@/lib/varikiApi';

interface ShopItemDialogProps {
  /** null — создаём новый подарок, объект — правим существующий. */
  item: ShopItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Карточка подарка в магазине вариков — создание и правка.
 *
 * Количество сертификатов здесь НЕ задаётся числом: реальный запас — это файлы,
 * загруженные на складе подарка. Поле «Сколько планируем» нужно только чтобы
 * показать сотрудникам «осталось 3 из 5», а продать больше файлов, чем есть,
 * система всё равно не даст.
 */
const ShopItemDialog = ({ item, open, onOpenChange, onSaved }: ShopItemDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stockLimit, setStockLimit] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [icon, setIcon] = useState('Gift');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(item?.title || '');
    setDescription(item?.description || '');
    setPrice(item ? String(item.price) : '');
    setStockLimit(item?.stockLimit != null ? String(item.stockLimit) : '');
    setImageUrl(item?.imageUrl || '');
    setIcon(item?.icon || 'Gift');
    setIsActive(item?.isActive ?? true);
  }, [open, item]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: 'Укажите название подарка', variant: 'destructive' });
      return;
    }
    const priceNum = Number(price);
    if (!priceNum || priceNum <= 0) {
      toast({ title: 'Укажите цену в вариках', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      await saveShopItem(
        {
          itemId: item?.id,
          title: title.trim(),
          description: description.trim() || null,
          price: priceNum,
          imageUrl: imageUrl.trim() || null,
          icon: icon.trim() || 'Gift',
          animation: item?.animation || 'none',
          stockLimit: stockLimit ? Number(stockLimit) : null,
          isActive,
        },
        user?.id,
      );
      toast({ title: item ? 'Подарок обновлён' : 'Подарок добавлен в магазин' });
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Изменить подарок' : 'Новый подарок'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Поход в кинотеатр"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Что получит сотрудник и как этим воспользоваться"
              rows={3}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Цена в вариках</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="8000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Сколько планируем выдать</Label>
              <Input
                type="number"
                inputMode="numeric"
                value={stockLimit}
                onChange={(e) => setStockLimit(e.target.value)}
                placeholder="5"
              />
              <p className="text-xs text-muted-foreground">
                Для подписи «осталось 3 из 5». Продать больше загруженных
                сертификатов система не даст.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Ссылка на картинку</Label>
            <Input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
            />
            {imageUrl && (
              <img
                src={imageUrl}
                alt=""
                className="mt-2 h-28 w-full rounded-md object-cover"
              />
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="font-medium">Показывать в магазине</p>
              <p className="text-xs text-muted-foreground">
                Выключите, пока готовите подарок к запуску
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ShopItemDialog;
