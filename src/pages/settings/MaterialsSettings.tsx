import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  fetchCategories,
  createCategory,
  createItem,
  type InventoryCategory,
} from '@/lib/inventoryApi';

const MaterialsSettings = () => {
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryTab, setNewCategoryTab] = useState('');
  const [saving, setSaving] = useState(false);

  const [itemDialogCategory, setItemDialogCategory] = useState<InventoryCategory | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemQuantity, setItemQuantity] = useState('');
  const [itemRolls, setItemRolls] = useState('');
  const [itemStatus, setItemStatus] = useState('В наличии');

  const load = () => {
    setLoading(true);
    fetchCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !newCategoryTab.trim()) return;
    setSaving(true);
    try {
      await createCategory(newCategoryName.trim(), newCategoryTab.trim());
      setNewCategoryName('');
      setNewCategoryTab('');
      setCategoryDialogOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleCreateItem = async () => {
    if (!itemDialogCategory || !itemName.trim()) return;
    setSaving(true);
    try {
      await createItem(
        itemDialogCategory.id,
        itemName.trim(),
        itemQuantity.trim() || '0',
        itemRolls.trim() || '0',
        itemStatus
      );
      setItemName('');
      setItemQuantity('');
      setItemRolls('');
      setItemStatus('В наличии');
      setItemDialogCategory(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const existingTabs = Array.from(new Set(categories.map((c) => c.tab)));

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Материалы</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Категории и позиции для страницы «Материалы на складе»
            </p>
          </div>

          <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Icon name="Plus" size={16} className="mr-1.5" />
                Новая категория
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая категория</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cat-name">Название категории</Label>
                  <Input
                    id="cat-name"
                    placeholder="Например: Тюль"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cat-tab">Вкладка</Label>
                  <Input
                    id="cat-tab"
                    placeholder="Например: Ткани"
                    value={newCategoryTab}
                    onChange={(e) => setNewCategoryTab(e.target.value)}
                    list="existing-tabs"
                  />
                  <datalist id="existing-tabs">
                    {existingTabs.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    Существующие вкладки: {existingTabs.join(', ') || '—'}
                  </p>
                </div>
                <Button onClick={handleCreateCategory} disabled={saving} className="w-full">
                  {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Создать'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Категорий пока нет — создайте первую.</p>
        ) : (
          <div className="space-y-6">
            {categories.map((c) => (
              <div key={c.id} className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border p-4">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">Вкладка: {c.tab}</p>
                  </div>
                  <Dialog
                    open={itemDialogCategory?.id === c.id}
                    onOpenChange={(open) => setItemDialogCategory(open ? c : null)}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline">
                        <Icon name="Plus" size={14} className="mr-1.5" />
                        Позиция
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Новая позиция в «{c.name}»</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label htmlFor="item-name">Название</Label>
                          <Input
                            id="item-name"
                            placeholder="Например: Вуаль"
                            value={itemName}
                            onChange={(e) => setItemName(e.target.value)}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="item-qty">Кол-во</Label>
                            <Input
                              id="item-qty"
                              placeholder="120 м"
                              value={itemQuantity}
                              onChange={(e) => setItemQuantity(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="item-rolls">Рулоны</Label>
                            <Input
                              id="item-rolls"
                              placeholder="4"
                              value={itemRolls}
                              onChange={(e) => setItemRolls(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="item-status">Статус</Label>
                          <Input
                            id="item-status"
                            placeholder="В наличии / Заканчивается"
                            value={itemStatus}
                            onChange={(e) => setItemStatus(e.target.value)}
                          />
                        </div>
                        <Button onClick={handleCreateItem} disabled={saving} className="w-full">
                          {saving ? (
                            <Icon name="Loader2" size={16} className="animate-spin" />
                          ) : (
                            'Добавить'
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Название</TableHead>
                      <TableHead>Кол-во</TableHead>
                      <TableHead>Рулоны</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          Нет позиций
                        </TableCell>
                      </TableRow>
                    ) : (
                      c.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.name}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>{item.rolls}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{item.status}</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default MaterialsSettings;
