import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import ShopItemDialog from '@/components/crm/variki/ShopItemDialog';
import {
  fetchShopManage,
  uploadCertificates,
  type ShopItem,
} from '@/lib/varikiApi';

/**
 * Управление магазином вариков — вкладка администратора.
 *
 * Здесь админ заводит подарки и заранее загружает пачку готовых сертификатов.
 * После этого покупка выдаётся сотруднику мгновенно: раньше он покупал и ждал,
 * пока админ вручную найдёт и пришлёт купон.
 *
 * Количество ограничено ровно числом загруженных файлов: продать сертификатов
 * больше, чем есть, система не даст.
 */
const VarikiShopManage = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogItem, setDialogItem] = useState<ShopItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<number | null>(null);

  const load = () => {
    if (!user?.id) return;
    setLoading(true);
    fetchShopManage(user.id)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const pickFiles = (itemId: number) => {
    targetRef.current = itemId;
    fileRef.current?.click();
  };

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    // Сбрасываем сразу: иначе повторный выбор тех же файлов не вызовет событие.
    e.target.value = '';
    const itemId = targetRef.current;
    if (!list.length || !itemId) return;

    setUploadingId(itemId);
    try {
      const files = await Promise.all(
        list.map(
          (f) =>
            new Promise<{ fileBase64: string; fileName: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({ fileBase64: String(reader.result), fileName: f.name });
              reader.onerror = () => reject(new Error(`Не удалось прочитать ${f.name}`));
              reader.readAsDataURL(f);
            }),
        ),
      );
      const res = await uploadCertificates(itemId, files, user?.id, user?.name);
      toast({
        title: `Загружено сертификатов: ${res.saved}`,
        description: `Доступно к покупке: ${res.available}`,
      });
      load();
    } catch (err) {
      toast({
        title: 'Не удалось загрузить',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploadingId(null);
      targetRef.current = null;
    }
  };

  return (
    <CrmLayout>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={handleFiles}
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Управление магазином</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Подарки за варики и запас готовых сертификатов
            </p>
          </div>
          <Button
            className="shrink-0"
            onClick={() => {
              setDialogItem(null);
              setDialogOpen(true);
            }}
          >
            <Icon name="Plus" size={16} className="mr-1.5" />
            Новый подарок
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const out = item.available === 0;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-3"
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-20 w-28 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon name={item.icon} size={28} className="text-muted-foreground" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{item.title}</p>
                      {!item.isActive && <Badge variant="outline">Скрыт</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.price} вариков
                      {item.stockLimit != null && ` · план ${item.stockLimit} шт`}
                    </p>

                    {/* Главное число на странице: сколько сертификатов реально
                        лежит на складе и может уйти сотрудникам прямо сейчас. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          out
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {out
                          ? 'Нет сертификатов — купить нельзя'
                          : `Готово к выдаче: ${item.available}`}
                      </span>
                      {!!item.issued && (
                        <span className="text-xs text-muted-foreground">
                          выдано {item.issued}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={uploadingId === item.id}
                      onClick={() => pickFiles(item.id)}
                    >
                      <Icon
                        name={uploadingId === item.id ? 'Loader2' : 'Upload'}
                        size={15}
                        className={`mr-1.5 ${uploadingId === item.id ? 'animate-spin' : ''}`}
                      />
                      Загрузить сертификаты
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDialogItem(item);
                        setDialogOpen(true);
                      }}
                    >
                      <Icon name="Pencil" size={15} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Сертификаты — PDF-файлы. Можно выбрать сразу несколько: каждый уйдёт своему
          сотруднику, один файл дважды не выдаётся.
        </p>
      </div>

      <ShopItemDialog
        item={dialogItem}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={load}
      />
    </CrmLayout>
  );
};

export default VarikiShopManage;
