import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import ShopItemDialog from '@/components/crm/variki/ShopItemDialog';
import CertificatesDialog from '@/components/crm/variki/CertificatesDialog';
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
const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

/** Подпись про срок продажи для строки списка. */
const periodLabel = (item: ShopItem) => {
  if (!item.validFrom && !item.validTo) return 'бессрочно';
  if (item.validFrom && item.validTo)
    return `${formatDate(item.validFrom)} — ${formatDate(item.validTo)}`;
  if (item.validTo) return `до ${formatDate(item.validTo)}`;
  return `с ${formatDate(item.validFrom!)}`;
};

const VarikiShopManage = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogItem, setDialogItem] = useState<ShopItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [certItem, setCertItem] = useState<ShopItem | null>(null);

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

    // Отсеиваем тяжёлые файлы сразу: сервер их всё равно не примет, а так
    // админ узнает причину мгновенно и без ожидания загрузки.
    const tooBig = list.filter((f) => f.size > 2560 * 1024);
    const ok = list.filter((f) => f.size <= 2560 * 1024);
    if (tooBig.length) {
      toast({
        title: `Не подойдут: ${tooBig.length} файл(ов)`,
        description: `${tooBig
          .slice(0, 3)
          .map((f) => f.name)
          .join(', ')} — размер больше 2,5 МБ`,
        variant: 'destructive',
      });
    }
    if (!ok.length) return;

    setUploadingId(itemId);
    try {
      const files = await Promise.all(
        ok.map(
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
      // Часть файлов могла не пройти (слишком большой, битый). Молчать нельзя:
      // админ будет думать, что загрузились все, и продаст больше, чем есть.
      if (res.errors.length) {
        toast({
          title: res.saved
            ? `Загружено ${res.saved} из ${ok.length}`
            : 'Не удалось загрузить',
          description: res.errors.slice(0, 3).join('; '),
          variant: 'destructive',
        });
      } else {
        toast({
          title: `Загружено сертификатов: ${res.saved}`,
          description: `Доступно к покупке: ${res.available}`,
        });
      }
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

  // Страница доступна по прямой ссылке, поэтому проверяем роль здесь, а не
  // только прячем пункт меню: сертификаты и цены — не для сотрудников.
  if (user && user.role !== 'admin') {
    return (
      <CrmLayout>
        <div className="py-16 text-center">
          <Icon name="Lock" size={32} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Раздел доступен только администратору</p>
          <Button className="mt-4" onClick={() => navigate('/crm/variki/shop')}>
            Перейти в магазин
          </Button>
        </div>
      </CrmLayout>
    );
  }

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
              // У подарков по записи склада нет: сертификат бронируется под
              // конкретный день. Пустой остаток для них — норма, а не проблема.
              const out = !item.needsVisitDate && item.available === 0;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 sm:gap-4"
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      className="h-16 w-20 shrink-0 rounded-md object-cover sm:h-20 sm:w-28"
                    />
                  ) : (
                    <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-muted sm:h-20 sm:w-28">
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
                      {` · ${periodLabel(item)}`}
                      {item.needsVisitDate && ' · по записи'}
                    </p>

                    {/* Контакты видны в списке: сразу понятно, у каких подарков
                        они не заполнены — сотруднику некуда будет идти. */}
                    {(item.orgAddress || item.orgPhone) && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[item.orgAddress, item.orgPhone].filter(Boolean).join(' · ')}
                      </p>
                    )}

                    {/* Главное число на странице: сколько сертификатов реально
                        лежит на складе и может уйти сотрудникам прямо сейчас. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          item.needsVisitDate
                            ? 'bg-violet-100 text-violet-900'
                            : out
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-emerald-100 text-emerald-900'
                        }`}
                      >
                        {item.needsVisitDate
                          ? 'По записи — сертификат бронируете вы'
                          : out
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

                  {/* На телефоне кнопки занимают всю ширину карточки: раньше три
                      кнопки в ряд не помещались и «Проверить» уезжала за экран. */}
                  <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
                    <Button
                      size="sm"
                      className="flex-1 sm:flex-none"
                      disabled={uploadingId === item.id}
                      onClick={() => pickFiles(item.id)}
                    >
                      <Icon
                        name={uploadingId === item.id ? 'Loader2' : 'Upload'}
                        size={15}
                        className={`mr-1.5 ${uploadingId === item.id ? 'animate-spin' : ''}`}
                      />
                      <span className="sm:hidden">Загрузить</span>
                      <span className="hidden sm:inline">Загрузить сертификаты</span>
                    </Button>
                    {/* Проверить загруженное: какие файлы лежат, кому что ушло.
                        Прячем у подарков без сертификатов — смотреть там нечего. */}
                    {(item.available > 0 || !!item.issued) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 sm:flex-none"
                        onClick={() => setCertItem(item)}
                      >
                        <Icon name="Eye" size={15} className="mr-1.5" />
                        Проверить
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
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
          Сертификаты — PDF-файлы размером до 2,5 МБ. Можно выбрать сразу несколько:
          каждый уйдёт своему сотруднику, один файл дважды не выдаётся.
        </p>
      </div>

      <ShopItemDialog
        item={dialogItem}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={load}
      />

      <CertificatesDialog
        itemId={certItem?.id ?? null}
        itemTitle={certItem?.title ?? ''}
        open={!!certItem}
        onOpenChange={(v) => {
          if (!v) {
            setCertItem(null);
            // Пересчитываем остатки: админ мог удалить файлы, и счётчик
            // «готово к выдаче» на странице стал бы неверным.
            load();
          }
        }}
      />
    </CrmLayout>
  );
};

export default VarikiShopManage;
