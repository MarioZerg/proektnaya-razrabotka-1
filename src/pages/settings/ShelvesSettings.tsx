import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchShelves, createShelf, deleteShelf, renameShelf, type Shelf } from '@/lib/shelvesApi';

const ShelvesSettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  // Какую полку сейчас переименовываем и на что. Правка идёт прямо в строке
  // таблицы: отдельное окно ради одного поля только мешает.
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const load = () => {
    setLoading(true);
    fetchShelves()
      .then(setShelves)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createShelf(name.trim(), user?.id);
      setName('');
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async () => {
    if (editId === null || !editName.trim()) return;
    try {
      await renameShelf(editId, editName.trim(), user?.id);
      setEditId(null);
      setEditName('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось переименовать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteShelf(id, user?.id);
      load();
    } catch (e) {
      toast({ title: 'Не удалось удалить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Полки на складе</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Полку при укладке система выбирает сама: однотипный товар кладёт вместе,
            ходовой — на ближние полки. На одной полке не больше 50 вещей, дальше
            занимается следующая свободная
          </p>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <Input
              placeholder="Название полки, например A-01"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="max-w-xs"
            />
            <Button onClick={handleCreate} disabled={saving || !name.trim()}>
              <Icon name="Plus" size={16} className="mr-1.5" />
              Добавить
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shelves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Полок пока нет</p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Товаров из 50</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shelves.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell className="font-medium">
                      {editId === s.id ? (
                        <Input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename();
                            if (e.key === 'Escape') setEditId(null);
                          }}
                          className="max-w-xs"
                        />
                      ) : (
                        s.name
                      )}
                    </TableCell>
                    <TableCell>{s.itemsCount}</TableCell>
                    <TableCell>
                      {isAdmin && (
                        <div className="flex justify-end gap-2">
                          {editId === s.id ? (
                            <>
                              <Button size="icon" onClick={handleRename} title="Сохранить">
                                <Icon name="Check" size={14} />
                              </Button>
                              <Button
                                size="icon"
                                variant="outline"
                                onClick={() => setEditId(null)}
                                title="Отменить"
                              >
                                <Icon name="X" size={14} />
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => {
                                setEditId(s.id);
                                setEditName(s.name);
                              }}
                              title="Переименовать"
                            >
                              <Icon name="Pencil" size={14} />
                            </Button>
                          )}
                          <Button size="icon" variant="destructive" onClick={() => handleDelete(s.id)}>
                            <Icon name="Trash2" size={14} />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ShelvesSettings;