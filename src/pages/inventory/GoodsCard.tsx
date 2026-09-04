import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import RestoreLostDialog from '@/components/crm/goodsWarehouse/RestoreLostDialog';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import {
  statusLabels,
  statusVariant,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';
import GoodsCardActions from '@/components/crm/goodsCard/GoodsCardActions';
import GoodsCardDetails from '@/components/crm/goodsCard/GoodsCardDetails';
import GoodsCardHistory from '@/components/crm/goodsCard/GoodsCardHistory';
import GoodsReturnHistory from '@/components/crm/goodsCard/GoodsReturnHistory';

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
    if (!card) return;
    // Вещь, подобранную с полки, печатаем по её НОВОМУ заказу (бронь); вещь,
    // сшитую сразу под заказ, — по СВОЕМУ. Раньше карточка знала только про
    // бронь, и на сшитой под заказ вещи кнопка молча ничего не делала: у неё
    // reservedOrderId пустой. Именно такие вещи и лежат в коробах поставок.
    const printOrderId = card.reservedOrderId || card.sourceOrderId;
    if (!printOrderId) return;
    setPrinting(true);
    try {
      // Перед печатью проверяем, нужна ли вещь под этот заказ до сих пор: он мог
      // уехать к покупателю или отмениться, пока она лежала на полке. Тогда ярлык
      // маркетплейс уже не отдаст, и печатать нечего — вещь возвращается на полку,
      // а кладовщик получает понятное объяснение вместо ошибки печати.
      //
      // Проверка нужна только для подобранной вещи: у сшитой под заказ вещи
      // брони нет, отбирать у неё нечего.
      if (card.reservedOrderId) {
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
      }

      await printOrderMarketplaceLabel({
        id: printOrderId,
        orderNumber: card.reservedOrderNumber || card.sourceOrderNumber || '',
        marketplace: card.reservedMarketplace || card.sourceMarketplace,
        orderType: card.reservedOrderType || card.sourceOrderType,
      });
      // ПЕРЕПЕЧАТКА НИЧЕГО НЕ МЕНЯЕТ В СИСТЕМЕ.
      //
      // Вещь уже на поставке (ждёт короба или лежит в нём) — ярлык на ней
      // отмечен, и трогать её состояние нельзя. Отметка ship_label вернула бы
      // вещь в статус «На сборке», то есть выбила бы её из собранного короба:
      // поставка недосчиталась бы позиции, а кладовщик искал бы вещь, которая
      // физически лежит на месте. Здесь просто выходит второй такой же ярлык.
      const inSupply =
        card.status === 'awaiting_supply' || card.status === 'reserved' || !!card.supplyId;
      if (inSupply) {
        toast({
          title: 'Стикер отправлен на печать',
          description: 'Наклейте его вместо испорченного — в системе ничего не изменилось',
        });
        setPrinting(false);
        return;
      }

      // Отмечаем наклейку ярлыка в системе, а не только на экране.
      //
      // Раньше кнопка лишь запоминала печать в браузере: вещь выглядела готовой,
      // но сервер об этом не знал и на «Отправить на поставку» отвечал «сначала
      // напечатайте стикер FBS». Кладовщик оказывался в тупике — печатал снова и снова.
      // Ошибку отметки НЕ глушим, но и печать из-за неё не отменяем: стикер уже
      // вышел из принтера. Раньше ответ сервера терялся молча — вещь выглядела
      // готовой, а на отправке всплывало «сначала напечатайте стикер», и понять
      // причину было невозможно.
      try {
        await shipLabelGoods(card.storageBarcode, user?.id, user?.name);
        toast({ title: 'Стикер отправлен на печать' });
      } catch (markErr) {
        toast({
          title: 'Стикер напечатан, но отметка не сохранилась',
          description:
            (markErr instanceof Error ? markErr.message : '') +
            ' Наклейте стикер и нажмите «Отправить на поставку» — отметка проставится.',
          variant: 'destructive',
        });
      }
      setJustPrinted(true);
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
        await shipLabelGoods(card.storageBarcode, user?.id, user?.name);
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
  const isFbo = (card.reservedOrderType || card.sourceOrderType || '').toUpperCase() === 'FBO';
  const schemeLabel = isFbo ? 'FBO' : 'FBS';
  // Вещь уже в пути на поставку: либо ждёт короба, либо отсканирована в него.
  // 'reserved' — это и есть «лежит в коробе»: кнопку «Отправить на поставку»
  // ей показывать не надо, а вот перепечатать ярлык бывает нужно.
  const alreadyInSupply =
    card.status === 'awaiting_supply' || card.status === 'reserved' || !!card.supplyId;
  // Стикер отправления печатаем только на вещь, которую собирают ПРЯМО СЕЙЧАС:
  // снята с полки («На сборке») или сшита и ждёт поставки («На поставку»).
  // Вещь «На хранении» лежит свободной, даже если за ней когда-то закрепляли заказ, —
  // ярлык ей не нужен, а наклеенный по ошибке уводит чужой товар в поставку.
  //
  // 'reserved' сюда добавлен намеренно: это вещь, уже отсканированная в короб
  // поставки. Именно на ней чаще всего и заминало стикер — пакет лежит в
  // коробе, ярлык порван, а перепечатать было неоткуда: карточка показывала
  // только надпись «Вещь на поставке» без единой кнопки.
  const canPrintLabel =
    !!(card.reservedOrderId || card.sourceOrderId) &&
    (card.status === 'picking' ||
      card.status === 'awaiting_supply' ||
      card.status === 'reserved') &&
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

        <GoodsCardActions
          card={card}
          isAdmin={isAdmin}
          labeled={labeled}
          isFbo={isFbo}
          schemeLabel={schemeLabel}
          alreadyInSupply={alreadyInSupply}
          canPrintLabel={canPrintLabel}
          printing={printing}
          sending={sending}
          onPrint={handlePrint}
          onSendToSupply={handleSendToSupply}
          onRestore={() => setRestoreOpen(true)}
          onSendToSewing={setSewingItem}
          onNotFound={setNotFoundItem}
        />

        <GoodsCardDetails card={card} />

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

        {/* Сколько раз вещь возвращали — по этому кладовщик решает,
            осматривать её или можно сразу на полку. */}
        <GoodsReturnHistory goodsId={Number(id)} />

        <GoodsCardHistory history={card.history} />
      </div>
    </CrmLayout>
  );
};

export default GoodsCard;