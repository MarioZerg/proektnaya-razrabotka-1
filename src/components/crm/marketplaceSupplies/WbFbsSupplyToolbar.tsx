import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import printHtmlInIframe from '@/lib/printInIframe';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface WbFbsSupplyToolbarProps {
  supply: SupplyDetail;
  canDeliver: boolean;
  delivering: boolean;
  onDeliver: () => void;
}

/** Шапка сборки WB FBS: счётчики, печать стикеров коробов и передача в доставку. */
const WbFbsSupplyToolbar = ({ supply, canDeliver, delivering, onDeliver }: WbFbsSupplyToolbarProps) => {
  // Уникальные стикеры коробов (один trbx-стикер может относиться к нескольким заказам).
  const boxStickers = Array.from(
    new Map(
      supply.wbOrders
        .filter((o) => o.stickerUrl)
        .map((o) => [o.wbTrbxId || o.stickerUrl!, { url: o.stickerUrl!, label: o.wbTrbxId || '' }])
    ).values()
  );

  /**
   * Печать стикеров коробов WB на этикеточном принтере 58×40 мм.
   *
   * Раньше страница печати открывалась во всплывающем окне без указания размера листа:
   * браузер брал A4 и книжную ориентацию, а в настройках принтера размер уже не менялся —
   * кладовщик получал стикер на четверть листа. Теперь лист жёстко задан как 58×40, поля
   * нулевые, а картинка растягивается на всю наклейку, и принтер печатает как надо.
   *
   * Печатаем через скрытый iframe, а не новым окном: всплывающие окна блокирует браузер,
   * и на терминале склада кладовщик просто не видел диалога печати.
   */
  const handlePrintStickers = () => {
    if (!boxStickers.length) return;
    const pages = boxStickers
      .map((s) => `<div class="label"><img src="${s.url}" alt="Стикер короба" /></div>`)
      .join('');
    printHtmlInIframe(
      `<!doctype html><html><head><meta charset="utf-8"><title>Стикеры коробов WB</title>
      <style>
        @page { size: 58mm 40mm; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 58mm; }
        body { font-family: Arial, Helvetica, sans-serif; }
        .label {
          width: 58mm; height: 40mm;
          display: flex; align-items: center; justify-content: center;
          overflow: hidden;
          /* Каждый стикер — свой лист: рулонный принтер отрежет по границе наклейки. */
          page-break-after: always;
          break-after: page;
        }
        .label:last-child { page-break-after: auto; break-after: auto; }
        /* Картинка от WB уже в пропорции наклейки — вписываем её целиком, без обрезки. */
        .label img { max-width: 58mm; max-height: 40mm; width: auto; height: auto; }
      </style></head><body>${pages}</body></html>`,
    );
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {/* Сколько заказов лежит в резервной поставке на WB: туда упаковщицы
            переносят всё, что застикеровали на конвейере. Это и есть объём работы —
            столько кладовщику предстоит отсканировать в свою поставку.
            Не успел забрать всё — остаток так и останется в резерве и попадёт
            в счётчик следующей поставки, как только он её создаст. */}
        <span>
          Ожидают отгрузки: <b>{supply.wbReadyCount}</b>
        </span>
        <span>
          Отсканировано в поставку: <b>{supply.wbOrders.length}</b>
        </span>
        {supply.wbSupplyId && (
          <span className="text-muted-foreground">
            WB: <b className="font-mono-tech">{supply.wbSupplyId}</b>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {boxStickers.length > 0 && (
          <Button variant="outline" className="w-full sm:w-auto" onClick={handlePrintStickers}>
            <Icon name="Printer" size={16} className="mr-1.5" />
            Стикеры ({boxStickers.length})
          </Button>
        )}
        {canDeliver && (
          <Button onClick={onDeliver} disabled={delivering} className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto">
            <Icon name={delivering ? 'Loader2' : 'Truck'} size={16} className={`mr-1.5 ${delivering ? 'animate-spin' : ''}`} />
            В доставку
          </Button>
        )}
      </div>
    </div>
  );
};

export default WbFbsSupplyToolbar;
