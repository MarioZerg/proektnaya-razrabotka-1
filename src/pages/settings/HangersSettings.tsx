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
import { fetchHangers, createHanger, deleteHanger, type Hanger } from '@/lib/hangersApi';

const HangersSettings = () => {
  const { toast } = useToast();
  const [hangers, setHangers] = useState<Hanger[]>([]);
  const [loading, setLoading] = useState(true);
  const [number, setNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

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
    const n = Number(number);
    if (!n || n <= 0) {
      toast({ title: 'Укажите номер вешалки', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createHanger(n);
      setNumber('');
      toast({ title: `Вешалка № ${n} добавлена` });
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
            <div className="w-40 space-y-1.5">
              <Label>Номер вешалки</Label>
              <Input
                type="number"
                min={1}
                placeholder="Например: 12"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
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
              <p className="text-sm text-muted-foreground">Вешалок пока нет — добавьте первую.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hangers.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5"
                  >
                    <span className="font-semibold">№ {h.number}</span>
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
              свой номер вешалки.
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
