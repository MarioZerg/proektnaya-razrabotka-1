import { useEffect, useRef, useState } from 'react';
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
import {
  fetchShelves,
  createShelf,
  deleteShelf,
  renameShelf,
  compressShelfPhoto,
  setShelfPhoto,
  clearShelfPhoto,
  type Shelf,
} from '@/lib/shelvesApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import ShelfPhotoDialog from '@/components/crm/goodsWarehouse/ShelfPhotoDialog';

const canUploadShelfPhoto = (role?: string) =>
  role === 'admin' || role === 'storekeeper' || role === 'senior_storekeeper';

const ShelvesSettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  // Какую полку сейчас переименовываем и на что. Правка идёт прямо в строке
  // таблицы: отдельное окно ради одного поля только мешает.
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [view, setView] = useState<Shelf | null>(null);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadShelfId = useRef<number | null>(null);
  const canUpload = canUploadShelfPhoto(user?.role);

  const load = () => {
    setLoading(true);
    fetchShelves()
      .then((list) => {
        setListError(null);
        setShelves(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить полки');
      })
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

  const pickPhoto = (id: number) => {
    uploadShelfId.current = id;
    if (fileRef.current) fileRef.current.value = '';
    fileRef.current?.click();
  };

  const handlePhoto = async (file: File | undefined) => {
    const id = uploadShelfId.current;
    if (!file || id === null) return;
    setUploadingId(id);
    try {
      const photo = await compressShelfPhoto(file);
      const photoUrl = await setShelfPhoto(id, photo, user?.id);
      setShelves((list) => list.map((s) => (s.id === id ? { ...s, photoUrl } : s)));
    } catch (e) {
      toast({
        title: 'Не удалось сохранить фото',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploadingId(null);
    }
  };

  const handleClearPhoto = async (id: number) => {
    try {
      await clearShelfPhoto(id, user?.id);
      setShelves((list) => list.map((s) => (s.id === id ? { ...s, photoUrl: null } : s)));
      if (view?.id === id) setView(null);
    } catch (e) {
      toast({
        title: 'Не удалось убрать фото',
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
            ходовой — на ближние полки, остальное — на самую свободную. Ограничения
            по количеству вещей на полке нет. Фото показывает, где стоит контейнер:
            его ставит кладовщик, и только после этого на карточке товара появляется
            кнопка «Посмотреть полку»
          </p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handlePhoto(e.target.files?.[0])}
        />

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

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить полки"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && shelves.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shelves.length === 0 ? (
          listError ? null : (
          <p className="text-sm text-muted-foreground">Полок пока нет</p>
          )
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">#</TableHead>
                  <TableHead className="text-primary-foreground">Название</TableHead>
                  <TableHead className="text-primary-foreground">Товаров</TableHead>
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
                      <div className="flex flex-wrap justify-end gap-2">
                        {s.photoUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setView(s)}
                          >
                            <Icon name="Eye" size={14} className="mr-1" />
                            Фото
                          </Button>
                        )}
                        {canUpload && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={uploadingId === s.id}
                              onClick={() => pickPhoto(s.id)}
                            >
                              <Icon
                                name={uploadingId === s.id ? 'Loader2' : 'Camera'}
                                size={14}
                                className={`mr-1 ${uploadingId === s.id ? 'animate-spin' : ''}`}
                              />
                              {s.photoUrl ? 'Заменить' : 'Добавить фото'}
                            </Button>
                            {s.photoUrl && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleClearPhoto(s.id)}
                              >
                                Убрать
                              </Button>
                            )}
                          </>
                        )}
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <ShelfPhotoDialog
          shelfName={view?.name ?? null}
          photoUrl={view?.photoUrl ?? null}
          onClose={() => setView(null)}
        />
      </div>
    </CrmLayout>
  );
};

export default ShelvesSettings;