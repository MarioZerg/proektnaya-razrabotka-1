import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchGoodsCard,
  sendGoodsToSupply,
  shipLabelGoods,
  verifyPicking,
  type GoodsCard as GoodsCardType,
} from '@/lib/goodsWarehouseApi';
import { printOrderMarketplaceLabel } from '@/lib/printOrderMarketplaceLabel';
import SendToSewingDialog from '@/components/crm/goodsWarehouse/SendToSewingDialog';
import NotFoundDialog, {
  type NotFoundTarget,
} from '@/components/crm/goodsWarehouse/NotFoundDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import RestoreLostDialog from '@/components/crm/goodsWarehouse/RestoreLostDialog';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import {
  statusLabels,
  statusVariant,
  reasonLabels,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Одна строка «свойство — значение» в карточке. */
const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className="text-right text-sm font-medium">{value}</span>
  </div>
);

/**
 * Карточка вещи со склада.
 *
 * Кладовщик проваливается сюда из списка подбора: видит, что это за вещь, где лежит,
 * под какой заказ подобрана и всю историю — кто её принял, кто отстикеровал.
 *
 * Отсюда же два действия по порядку: напечатать стикер FBS, а затем отправить вещь
 * на поставку — после этого она попадает в счётчик поставки FBS OZON.
 */
const GoodsCard = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [card, setCard] = useState<GoodsCardType | null>(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [sending, setSending] = useState(false);
  /** Стикер напечатан в этой сессии — показываем кнопку отправки сразу. */
  const [justPrinted, setJustPrinted] = useState(false);
  /** Открыт диалог отправки в пошив (нужна причина). */
  const [sewingItem, setSewingItem] = useState<GoodsWarehouseItem | null>(null);
  // «Товар не найден» — второй пункт меню действий. Раньше эта кнопка жила
  // отдельно в строке списка подбора.
  const [notFoundItem, setNotFoundItem] = useState<NotFoundTarget | null>(null);
  /** Открыт диалог возврата списанной вещи, которая нашлась. */
  const [restoreOpen, setRestoreOpen] = useState(false);

  // Возврат списанной вещи в оборот меняет остатки склада — это решение админа.
  // Сервер проверяет право ещё раз: спрятанной кнопки для защиты мало.
  const isAdmin = user?.role === 'admin';

  const load = () => {
    if (!id) return;
    setLoading(true);
    fetchGoodsCard(Number(id))
      .then(setCard)
      .catch((e) => {
        toast({
          title: 'Не удалось открыть карточку',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handlePrint = async () => {
    if (!card?.reservedOrderId) return;
    setPrinting(true);
    try {
      // Перед печатью проверяем, нужна ли вещь под этот заказ до сих пор: он мог
      // уехать к покупателю или отмениться, пока она лежала на полке. Тогда ярлык
      // маркетплейс уже не отдаст, и печатать нечего — вещь возвращается на полку,
      // а кладовщик получает понятное объяснение вместо ошибки печати.
      const check = await verifyPicking(card.id, user?.id, user?.name).catch(() => null);
      if (check && check.total > 0) {
        toast({
          title: 'Вещь больше не нужна под этот заказ',
          description: `${check.released[0]?.reason}. Вещь возвращена на полку хранения`,
          variant: 'destructive',
        });
        load();
        return;
      }

      await printOrderMarketplaceLabel({
        id: card.reservedOrderId,
        orderNumber: card.reservedOrderNumber || '',
        marketplace: card.reservedMarketplace,
        orderType: card.reservedOrderType,
      });
      // Отмечаем наклейку ярлыка в системе, а не только на экране.
      //
      // Раньше кнопка лишь запоминала печать в браузере: вещь выглядела готовой,
      // но сервер об этом не знал и на «Отправить на поставку» отвечал «сначала
      // напечатайте стикер FBS». Кладовщик оказывался в тупике — печатал снова и снова.
      await shipLabelGoods(card.storageBarcode, user?.id, user?.name).catch(() => undefined);
      setJustPrinted(true);
      toast({ title: 'Стикер отправлен на печать' });
      load();
    } catch (e) {
      toast({
        title: 'Стикер не пришёл',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  const handleSendToSupply = async () => {
    if (!card) return;
    setSending(true);
    try {
      // Если ярлык печатали, но отметка в системе не легла (сбой сети, старая вкладка),
      // проставляем её здесь же. Кладовщик держит наклеенную вещь в руках — разворачивать
      // его сообщением «сначала напечатайте стикер» нельзя.
      if (!card.shippingLabeledAt) {
        await shipLabelGoods(card.storageBarcode, user?.id, user?.name).catch(() => undefined);
      }
      await sendGoodsToSupply(card.id, user?.id, user?.name);
      toast({
        title: 'Отправлено на поставку',
        description: `Позиция появилась в счётчике поставки ${schemeLabel} ${
          card.reservedMarketplace || ''
        }`.trim(),
      });
      // Работа с этой вещью закончена — сразу возвращаем кладовщика к подбору.
      // Он стоит у стеллажа со сканером в руке: карточка отработавшей вещи ему уже
      // не нужна, а следующую он пикает сразу, не нажимая «Назад» и не целясь мышкой
      // в строку поиска (фокус там ставится сам при открытии страницы).
      navigate('/crm/inventory/goods-picking');
      return;
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  if (!card) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Товар не найден</p>
      </CrmLayout>
    );
  }

  // Стикер уже наклеен (в базе) или напечатан прямо сейчас — можно отправлять.
  const labeled = !!card.shippingLabeledAt || justPrinted;
  // Схема заказа, под который подобрана вещь. FBS и FBO — разные стикеры и разный
  // смысл действия: на FBS клеится ярлык маркетплейса (вещь поедет своим пакетом
  // к покупателю), на FBO — наш складской стикер с кодом товара (вещь пойдёт
  // коробкой на склад площадки). Раньше кнопка везде называлась «Напечатать стикер
  // FBS», хотя для FBO печатался правильный, FBO-стикер, — кладовщик видел «FBS»
  // на FBO-товаре и не решался печатать.
  const isFbo = (card.reservedOrderType || '').toUpperCase() === 'FBO';
  const schemeLabel = isFbo ? 'FBO' : 'FBS';
  const alreadyInSupply = card.status === 'awaiting_supply' || !!card.supplyId;
  // Стикер отправления печатаем только на вещь, которую собирают ПРЯМО СЕЙЧАС:
  // снята с полки («На сборке») или сшита и ждёт поставки («На поставку»).
  // Вещь «На хранении» лежит свободной, даже если за ней когда-то закрепляли заказ, —
  // ярлык ей не нужен, а наклеенный по ошибке уводит чужой товар в поставку.
  const canPrintLabel =
    !!card.reservedOrderId &&
    (card.status === 'picking' || card.status === 'awaiting_supply') &&
    // Вещь уехала на маркетплейс и там её приняли — отправление закрыто, ярлык
    // печатать некуда. Статусы 'shipped' и 'lost' сюда и так не попадают, но
    // дата отгрузки может проставиться раньше смены статуса.
    !card.shippedAt;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/crm/inventory/goods-picking')}
            className="-ml-2 mb-2"
          >
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К подбору
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">{card.product || 'Товар'}</h1>
              <p className="mt-1 font-mono-tech text-sm text-muted-foreground">
                {card.storageBarcode}
              </p>
            </div>
            <Badge variant={statusVariant[card.status]}>{statusLabels[card.status]}</Badge>
          </div>
        </div>

        {/* Вещь была списана (не нашли на складе или брак), но потом нашлась.
            Раньше это был тупик: запись оставалась мёртвой навсегда, вещь заводили
            заново с новым стикером, а история движения обрывалась. Теперь админ
            возвращает её на полку одной кнопкой — со всей прежней историей. */}
        {card.status === 'lost' && (
          <Card className="border-emerald-300 bg-emerald-50 shadow-none">
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-start gap-2.5">
                <Icon name="PackageSearch" size={20} className="mt-0.5 text-emerald-700" />
                <div>
                  <p className="font-semibold text-emerald-900">Товар списан со склада</p>
                  <p className="text-sm text-emerald-800">
                    {card.lostReason || 'Причина не указана'}
                  </p>
                </div>
              </div>
              {isAdmin ? (
                <Button onClick={() => setRestoreOpen(true)}>
                  <Icon name="PackageCheck" size={18} className="mr-2" />
                  Товар нашёлся — вернуть на полку
                </Button>
              ) : (
                <p className="text-sm text-emerald-800">
                  Если вещь нашлась, вернуть её на склад может администратор.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Действия по порядку: сначала стикер (FBS или FBO — по схеме заказа),
            потом отправка на поставку. Для списанной вещи этот блок не нужен:
            её сначала возвращают на полку. */}
        {card.status !== 'lost' && (
        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent className="space-y-3 pt-6">
            {alreadyInSupply ? (
              <div className="flex items-center gap-2.5">
                <Icon name="CircleCheck" size={20} className="text-emerald-600" />
                <div>
                  <p className="font-semibold">Вещь на поставке</p>
                  <p className="text-sm text-muted-foreground">
                    {card.supplyId
                      ? `Добавлена в поставку №${card.supplyId}`
                      : `Ждёт сканирования в короб поставки ${schemeLabel} ${
                          card.reservedMarketplace || ''
                        }`.trim()}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {labeled
                    ? 'Стикер готов — отправьте вещь на поставку'
                    : `Напечатайте стикер ${schemeLabel} и наклейте его на вещь`}
                </p>
                {isFbo && (
                  // Кладовщик должен понимать, ЧТО он печатает: на FBO-стикере код
                  // товара, по нему вещь принимают на складе маркетплейса.
                  <p className="text-xs text-muted-foreground">
                    Это FBO: печатается складской стикер с кодом товара — вещь поедет
                    коробкой на склад маркетплейса.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="lg"
                    onClick={handlePrint}
                    disabled={printing || !canPrintLabel}
                    variant={labeled ? 'outline' : 'default'}
                  >
                    <Icon
                      name={printing ? 'Loader2' : 'Printer'}
                      size={18}
                      className={`mr-2 ${printing ? 'animate-spin' : ''}`}
                    />
                    {labeled ? 'Напечатать ещё раз' : `Напечатать стикер ${schemeLabel}`}
                  </Button>
                  {labeled && (
                    <Button size="lg" onClick={handleSendToSupply} disabled={sending}>
                      <Icon
                        name={sending ? 'Loader2' : 'Truck'}
                        size={18}
                        className={`mr-2 ${sending ? 'animate-spin' : ''}`}
                      />
                      Отправить на поставку
                    </Button>
                  )}
                </div>
                {!canPrintLabel && (
                  <p className="text-sm text-muted-foreground">
                    {card.reservedOrderId
                      ? 'Вещь лежит на хранении — стикер отправления печатают только при сборке под заказ'
                      : 'Вещь пока не подобрана под заказ — стикер печатать не из чего'}
                  </p>
                )}

                {/* Оба «плохих» исхода по вещи — в одном меню.
                    Раньше «Отправить в пошив» жила здесь, а «Не нашёл» дублировалась
                    в строке списка: две кнопки в разных местах про одно и то же
                    решение — вещь со склада уходит, заказ едет шиться заново.
                    Теперь выбор делается один раз и в одном месте. */}
                <div className="border-t border-border pt-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline">
                        <Icon name="Settings2" size={18} className="mr-2" />
                        Действия с товаром
                        <Icon name="ChevronDown" size={16} className="ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuItem
                        onClick={() =>
                          setSewingItem({
                            id: card.id,
                            product: card.product,
                            orderNumber: card.reservedOrderNumber || card.sourceOrderNumber,
                            storageBarcode: card.storageBarcode,
                          } as GoodsWarehouseItem)
                        }
                      >
                        <Icon name="Shirt" size={16} className="mr-2" />
                        Отправить в пошив
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          setNotFoundItem({
                            id: card.id,
                            title: card.product || 'Товар',
                            orderNumber: card.reservedOrderNumber || card.sourceOrderNumber,
                            storageBarcode: card.storageBarcode,
                            shelfName: card.shelfName,
                          })
                        }
                      >
                        <Icon name="SearchX" size={16} className="mr-2" />
                        Товар не найден
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    В обоих случаях вещь спишется со склада, а заказ вернётся на конвейер
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="shadow-none">
            <CardContent className="pt-6">
              <h2 className="mb-2 font-semibold">О товаре</h2>
              <Row label="Ткань" value={card.material || '—'} />
              <Row
                label="Размер"
                value={card.width && card.height ? `${card.width}×${card.height}` : '—'}
              />
              <Row label="Полка" value={card.shelfName || '—'} />
              <Row
                label="Откуда на складе"
                value={reasonLabels[card.receiveReason as keyof typeof reasonLabels] || '—'}
              />
              <Row label="Заказ пошива" value={card.sourceOrderNumber || '—'} />
              <Row
                label="Подобран под заказ"
                value={card.reservedOrderNumber || '—'}
              />
              {card.lostReason && <Row label="Причина утери" value={card.lostReason} />}
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardContent className="pt-6">
              <h2 className="mb-2 font-semibold">Даты</h2>
              <Row label="Принят на склад" value={formatDate(card.receivedAt)} />
              <Row label="Подобран под заказ" value={formatDate(card.matchedAt)} />
              <Row label="Наклеен стикер" value={formatDate(card.shippingLabeledAt)} />
              <Row label="Отгружен" value={formatDate(card.shippedAt)} />
            </CardContent>
          </Card>
        </div>

        <RestoreLostDialog
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          goodsId={card.id}
          title={card.product || card.material || 'Товар'}
          storageBarcode={card.storageBarcode}
          currentShelfName={card.shelfName}
          onDone={load}
        />

        <SendToSewingDialog
          item={sewingItem}
          onOpenChange={(v) => !v && setSewingItem(null)}
          onDone={() => {
            setSewingItem(null);
            load();
          }}
        />

        <NotFoundDialog
          item={notFoundItem}
          onOpenChange={(v) => !v && setNotFoundItem(null)}
          onDone={() => {
            setNotFoundItem(null);
            load();
          }}
        />

        {/* История движения: кто из сотрудников что делал с этой вещью. */}
        <div className="space-y-2">
          <h2 className="font-semibold">История движения</h2>
          {card.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              История пока пустая — по этой вещи ещё не было событий
            </p>
          ) : (
            <div className="space-y-2">
              {card.history.map((h, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 rounded-md border border-border p-3"
                >
                  <Icon name="History" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{h.description || h.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.userName || 'Система'} · {formatDate(h.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CrmLayout>
  );
};

export default GoodsCard;