import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyBox, SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import BoxItemRow from '@/components/crm/marketplaceSupplies/BoxItemRow';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { printWbBoxLabel } from '@/lib/wbBoxLabel';
import { printBoxLabelFromUrl } from '@/lib/printMarketplaceLabel';

interface SupplyBoxCardProps {
  box: SupplyBox;
  supply: SupplyDetail;
  canEdit: boolean;
  /** WB FBO: закрыть короб в нашей системе и напечатать стикер WB. */
  isWbFbo: boolean;
  /** OZON FBO: закрыть короб — создаётся грузоместо на OZON и тянется этикетка. */
  isOzonFbo?: boolean;
  /** Закрыть ОДИН короб OZON и подтянуть его стикер. */
  onCloseOzonBox?: (boxId: number) => Promise<void>;
  onAddOrder: (boxId: number, orderNumber: string) => Promise<void>;
  onRemoveItem: (itemId: number) => void;
  /** Убрать сразу несколько штук одинакового товара из короба. */
  onSetItemCount: (boxId: number, itemIds: number[], removeCount: number) => void;
  onDeleteBox: (boxId: number) => void;
  onCloseBox: (boxId: number) => Promise<void>;
  /** Раскрыт ли короб. Открытым держим ровно один — тот, что набивают сейчас. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Короб поставки — свёрнутая плашка, которая раскрывается по клику.
 *
 * ПОЧЕМУ ПЛАШКА, А НЕ ОТКРЫТАЯ КАРТОЧКА. Раньше все короба висели развёрнутыми
 * в три колонки: у каждого своё поле сканера и полный список вещей. На поставке
 * в полсотни позиций экран превращался в простыню, и кладовщик пикал вещь в поле
 * короба, который в этот момент не видел — товар уезжал в соседний.
 *
 * Теперь открыт РОВНО ОДИН короб — тот, который кладовщик сейчас набивает. Поле
 * сканера есть только у него, промахнуться некуда. Свёрнутые показывают
 * количество и статус: этого хватает, чтобы понять картину, не раскрывая.
 */
const SupplyBoxCard = ({
  box,
  supply,
  canEdit,
  isWbFbo,
  isOzonFbo = false,
  onCloseOzonBox,
  onAddOrder,
  onRemoveItem,
  onSetItemCount,
  onDeleteBox,
  onCloseBox,
  open,
  onOpenChange,
}: SupplyBoxCardProps) => {
  const [orderNumber, setOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Раскрыли короб — сразу ставим курсор в поле сканера, чтобы кладовщик
  // не тянулся к нему мышкой перед каждым пиком.
  useEffect(() => {
    if (open && canEdit && !box.closedAt) {
      // Ждём окончания анимации раскрытия, иначе фокус слетает.
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open, canEdit, box.closedAt]);

  // OZON FBO: закрываем короб — сервер создаёт грузоместо на OZON и тянет PDF
  // этикетки именно этого короба. Печатать её кладовщик будет кнопкой ниже.
  const handleCloseOzon = async () => {
    if (!onCloseOzonBox) return;
    setClosing(true);
    try {
      await onCloseOzonBox(box.id);
    } finally {
      setClosing(false);
    }
  };

  const handleCloseAndPrint = async () => {
    setClosing(true);
    try {
      await onCloseBox(box.id);
      await printWbBoxLabel(supply, box);
    } finally {
      setClosing(false);
    }
  };

  /**
   * ПОЛЕ НЕ БЛОКИРУЕМ — СКАНЕР БЫСТРЕЕ СЕТИ.
   *
   * Раньше на время запроса поле уходило в disabled: кладовщик пикал следующую
   * вещь, а ввод улетал в никуда — браузер не принимает текст в заблокированное
   * поле. При хорошем темпе так терялась каждая вторая вещь, и приходилось
   * сканировать медленно, дожидаясь ответа сервера.
   *
   * Теперь поле живёт всегда: значение очищается сразу (защита от повторной
   * отправки того же кода), а ответ сервера догоняет позже и дорисовывает строку.
   * Так же сделано в FBS — там сканируют подряд без пауз.
   */
  const handleAdd = async () => {
    const value = orderNumber.trim();
    if (!value) return;
    setOrderNumber('');
    setScanning(true);
    // Фокус возвращаем немедленно, не дожидаясь сервера: следующий пик сканера
    // должен попасть в поле, даже если предыдущий запрос ещё в пути.
    inputRef.current?.focus();
    try {
      await onAddOrder(box.id, value);
    } finally {
      setScanning(false);
      inputRef.current?.focus();
    }
  };

  // Автоотправка работает только у РАСКРЫТОГО короба: у свёрнутых поля нет,
  // и ловить ввод сканера им незачем.
  useScannerAutoSubmit(orderNumber, handleAdd, canEdit && open);

  const canScan = canEdit && !box.closedAt;

  // ОДИНАКОВЫЙ ТОВАР — ОДНОЙ СТРОКОЙ С КОЛИЧЕСТВОМ.
  //
  // В коробе FBO лежат обезличенные вещи, и одного размера туда уходит по
  // десять-двадцать штук. Каждая занимала отдельную строку с номером складской
  // записи — короб на полсотни вещей превращался в простыню, по которой
  // невозможно сверить состав с заявкой.
  //
  // Номер складской записи кладовщику здесь не нужен: вещи взаимозаменяемы,
  // на приёмке считают штуки по артикулу. Поэтому схлопываем одинаковые в
  // строку «12 × Лен 300x255» — ровно то, что он сверяет глазами.
  //
  // Группируем по названию товара и статусу: вещь в статусе «Отгружен» и
  // «В коробе» — разные состояния, смешивать их в одну строку нельзя.
  const groupedItems = useMemo(() => {
    const map = new Map<
      string,
      { key: string; title: string; goodsStatus: string; itemIds: number[] }
    >();
    for (const item of box.items) {
      const title =
        item.product ||
        [item.material, item.width && item.height ? `${item.width}×${item.height}` : null]
          .filter(Boolean)
          .join(' ') ||
        item.orderNumber ||
        'Товар';
      const key = `${title}__${item.goodsStatus || ''}`;
      const row = map.get(key);
      if (row) {
        row.itemIds.push(item.id);
      } else {
        map.set(key, {
          key,
          title,
          goodsStatus: item.goodsStatus || '',
          itemIds: [item.id],
        });
      }
    }
    return [...map.values()].map((row) => ({ ...row, count: row.itemIds.length }));
  }, [box.items]);

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={`rounded-lg border ${
        open ? 'border-primary shadow-sm' : 'border-border'
      }`}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
        <Icon
          name="ChevronRight"
          size={16}
          className={`shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <Icon
          name={box.closedAt ? 'PackageCheck' : 'Package'}
          size={18}
          className={`shrink-0 ${box.closedAt ? 'text-emerald-600' : 'text-muted-foreground'}`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Короб №{box.boxNumber}</span>
            {/* Количество вещей — главное число плашки: по нему кладовщик
                понимает, куда класть следующую, не раскрывая короб. */}
            <Badge variant={box.items.length ? 'default' : 'outline'}>
              {box.items.length} шт.
            </Badge>
            {box.closedAt && (
              <Badge variant="secondary" className="text-[10px]">Закрыт</Badge>
            )}
            {/* ГРУЗОМЕСТО НА ПЛОЩАДКЕ — ГЛАВНЫЙ ПРИЗНАК, ЧТО КОРОБ РЕАЛЬНО УЕХАЛ.
                Закрытый короб без cargo_id означает, что на OZON его нет: заявка
                придёт без этого грузоместа, и на приёмке короб окажется лишним.
                Раньше оба состояния выглядели одинаково — просто «Закрыт». */}
            {isOzonFbo && box.closedAt && (
              box.ozonCargoId ? (
                <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
                  На OZON #{box.ozonCargoId}
                </Badge>
              ) : (
                <Badge className="bg-amber-600 text-[10px] text-white hover:bg-amber-600">
                  Не ушёл на OZON
                </Badge>
              )
            )}
          </div>
          <p className="truncate font-mono-tech text-xs text-muted-foreground">
            {box.barcode}
          </p>
        </div>

        {/* Подсказка на свёрнутой плашке: куда жать, чтобы начать набивать. */}
        {!open && canScan && (
          <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
            <Icon name="ScanLine" size={13} />
            Открыть и сканировать
          </span>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-3 border-t border-border p-4">
          {canScan && (
            <div className="flex gap-2">
              {/* У FBO в короб едет вещь с ярлыком ТОВАРА (OZN…) — именно его
                  читает приёмка площадки. Складской GW здесь не принимается:
                  по нему вещь только находят на полке перед стикеровкой. */}
              <Input
                ref={inputRef}
                placeholder={
                  isOzonFbo
                    ? 'Сканируйте ярлык товара OZON (OZN…)'
                    : 'Сканируйте пакет с товаром'
                }
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                className="font-mono-tech"
              />
              {scanning && (
                <div className="flex h-9 w-9 items-center justify-center">
                  <Icon name="Loader2" size={16} className="animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}

          {box.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">В коробе пока нет товаров</p>
          ) : (
            <div className="space-y-1.5">
              {groupedItems.map((row) => (
                <BoxItemRow
                  key={row.key}
                  title={row.title}
                  goodsStatus={row.goodsStatus}
                  itemIds={row.itemIds}
                  // Состав закрытого короба менять нельзя: он заклеен, и на
                  // OZON по нему уже заведено грузоместо с этикеткой.
                  canEdit={canEdit && !box.closedAt}
                  onRemoveCount={(ids, count) =>
                    count === 1 && ids.length === 1
                      ? onRemoveItem(ids[0])
                      : onSetItemCount(box.id, ids, count)
                  }
                />
              ))}
            </div>
          )}

          {/* OZON FBO: короб набит — закрываем. Сервер заводит грузоместо на OZON
              и возвращает этикетку на ЭТОТ короб, её сразу можно печатать. */}
          {isOzonFbo && box.items.length > 0 && !box.closedAt && (
            <Button
              size="sm"
              className="w-full"
              onClick={handleCloseOzon}
              disabled={closing}
            >
              <Icon
                name={closing ? 'Loader2' : 'PackageCheck'}
                size={14}
                className={`mr-1.5 ${closing ? 'animate-spin' : ''}`}
              />
              {closing ? 'Закрываем короб и получаем стикер…' : 'Закрыть короб'}
            </Button>
          )}

          {/* КОРОБ ЗАКРЫТ, НО ГРУЗОМЕСТА НА OZON НЕТ — ДАЁМ ПОВТОРИТЬ.
              Так бывает, когда площадка не ответила или отклонила состав. Без
              этой кнопки короб оставался закрытым навсегда: кладовщик не мог ни
              доложить вещь, ни отправить его на OZON, и поставка уезжала
              неполной. Повтор отправляет состав заново. */}
          {isOzonFbo && box.closedAt && !box.ozonCargoId && box.items.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-amber-500 text-amber-800 hover:bg-amber-50"
              onClick={handleCloseOzon}
              disabled={closing}
            >
              <Icon
                name={closing ? 'Loader2' : 'RefreshCw'}
                size={14}
                className={`mr-1.5 ${closing ? 'animate-spin' : ''}`}
              />
              {closing ? 'Отправляем на OZON…' : 'Повторить отправку на OZON'}
            </Button>
          )}

          {isWbFbo && box.items.length > 0 && !box.closedAt && (
            <Button
              size="sm"
              className="w-full bg-[#CB11AB] text-white hover:bg-[#a60d8b]"
              onClick={handleCloseAndPrint}
              disabled={closing}
            >
              <Icon
                name={closing ? 'Loader2' : 'PackageCheck'}
                size={14}
                className={`mr-1.5 ${closing ? 'animate-spin' : ''}`}
              />
              Закрыть короб и печать стикера
            </Button>
          )}

          {isWbFbo && box.closedAt && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => printWbBoxLabel(supply, box)}
            >
              <Icon name="Printer" size={14} className="mr-1.5" />
              Печать стикера короба
            </Button>
          )}

          {box.stickerUrl && (
            <div className="space-y-1.5">
              {/* Стикер короба от маркетплейса печатаем на наклейке 75×120 — той же, что у WB.
                  Раньше PDF просто открывался ссылкой и уходил на печать как A4.
                  Печать не мгновенная: файл скачивается и перерисовывается в
                  картинку. Без индикатора кладовщик жмёт кнопку повторно и
                  получает несколько окон печати подряд. */}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={printing}
                onClick={async () => {
                  setPrinting(true);
                  try {
                    await printBoxLabelFromUrl(
                      box.stickerUrl as string,
                      `Стикер короба №${box.boxNumber}`,
                    );
                  } finally {
                    setPrinting(false);
                  }
                }}
              >
                <Icon
                  name={printing ? 'Loader2' : 'Printer'}
                  size={14}
                  className={`mr-1.5 ${printing ? 'animate-spin' : ''}`}
                />
                {printing ? 'Готовим стикер…' : 'Печать стикера короба (75×120)'}
              </Button>
              <a
                href={box.stickerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              >
                <Icon name="FileText" size={12} />
                Открыть PDF
              </a>
            </div>
          )}

          {/* Удаление — внизу раскрытого короба, а не иконкой в шапке: чтобы
              случайно не снести короб, целясь в стрелку раскрытия. */}
          {canEdit && box.items.length === 0 && !box.closedAt && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => onDeleteBox(box.id)}
            >
              <Icon name="Trash2" size={14} className="mr-1.5" />
              Удалить пустой короб
            </Button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SupplyBoxCard;