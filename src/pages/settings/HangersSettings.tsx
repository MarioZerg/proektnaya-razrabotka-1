import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchHangers,
  createHanger,
  deleteHanger,
  renameHanger,
  hangerLabel,
  type Hanger,
} from '@/lib/hangersApi';

const HangersSettings = () => {
  const { toast } = useToast();
  const [hangers, setHangers] = useState<Hanger[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  // Какую вешалку сейчас переименовываем и на что.
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const load = () => {
    setLoading(true);
    fetchHangers()
      .then(setHangers)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    const value = name.trim();
    if (!value) {
      toast({ title: 'Укажите название вешалки', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createHanger(value);
      setName('');
      toast({ title: `Вешалка «${value}» добавлена` });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось добавить',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (id: number) => {
    const value = editName.trim();
    setEditId(null);
    const current = hangers.find((h) => h.id === id);
    if (!current || value === (current.name || '')) return;
    try {
      await renameHanger(id, value);
      load();
    } catch (err) {
      toast({
        title: 'Не удалось переименовать',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteHanger(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteId(null);
      toast({
        title: 'Не удалось удалить',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Вешалки</h1>
          {!loading && (
            <Badge variant="secondary" className="text-sm font-normal">
              Всего: {hangers.length}
            </Badge>
          )}
        </div>

        <Card className="border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Добавить вешалку</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end gap-3">
            {/* Вешалку называют так, как её зовут в цехе: «Синяя у окна», «Стойка А».
                Номер система подбирает сама — он нужен только внутри, чтобы связать
                вешалку с раскроенными заказами. */}
            <div className="w-64 space-y-1.5">
              <Label>Название вешалки</Label>
              <Input
                placeholder="Например: Синяя у окна"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>
            <Button onClick={handleCreate} disabled={saving}>
              <Icon name={saving ? 'Loader2' : 'Plus'} size={16} className={`mr-1.5 ${saving ? 'animate-spin' : ''}`} />
              Добавить вешалку
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Список вешалок</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loader2" size={16} className="animate-spin" />
                Загрузка...
              </div>
            ) : hangers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Вешалок пока нет — добавьте первую. Название можно менять: нажмите на него.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hangers.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5"
                  >
                    {/* Название правится прямо в списке: щёлкнул — исправил. */}
                    {editId === h.id ? (
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => handleRename(h.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(h.id);
                          if (e.key === 'Escape') setEditId(null);
                        }}
                        className="h-7 w-44"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditId(h.id);
                          setEditName(h.name || '');
                        }}
                        className="font-semibold hover:underline"
                        title="Переименовать"
                      >
                        {hangerLabel(h)}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setDeleteId(h.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Удалить"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить вешалку?</AlertDialogTitle>
            <AlertDialogDescription>
              Вешалка исчезнет из списка выбора при раскрое. Уже раскроенные заказы сохранят
              свою вешалку.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CrmLayout>
  );
};

export default HangersSettings;
