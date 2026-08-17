import printHtmlInIframe from '@/lib/printInIframe';

export interface FlyerStickerData {
  /** Название тюли — единственное, что меняется от стикера к стикеру. */
  materialName: string;
  /** Тесьма. По умолчанию 6 см — так шьют почти всё. */
  tape?: string;
  /** Цвет изделия. По умолчанию белый. */
  color?: string;
  /** Производитель — своё имя на вложении в посылку. */
  manufacturer?: string;
  /** Сколько наклеек в ленте. По умолчанию 20 — ровно рулончик на смену. */
  count?: number;
}

const esc = (v: string | number | null | undefined) =>
  String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] || c);

/**
 * Стикер состава на листовку, 58×40 мм.
 *
 * ЗАЧЕМ. В посылку к тюли кладётся рекламная листовка, и на неё упаковщица клеит
 * наклейку с составом товара: что за тюль, какая тесьма, какой цвет, кто произвёл.
 * Раньше такие наклейки заказывались в типографии на каждый материал отдельно: пока
 * партия едет, нужного вида нет под рукой, а неходовые виды лежат мёртвым запасом.
 * Теперь упаковщица печатает ленту сама — прямо на терминале в цехе.
 *
 * ПОЧЕМУ ЛЕНТА, А НЕ ОДНА НАКЛЕЙКА. Клеят их пачкой: за смену уходит вся лента на
 * один и тот же материал. Печатать по одной — это подходить к терминалу двадцать
 * раз, поэтому кнопка сразу выдаёт 20 одинаковых наклеек, разделённых разрывом
 * страницы: принтер этикеток отрезает их по одной.
 *
 * ЧТО МЕНЯЕТСЯ. Только название тюли. Тесьма 6 см, белый цвет и МегаТюль —
 * постоянные для всей продукции, поэтому вбиты значениями по умолчанию: чем меньше
 * полей на сенсорном экране, тем меньше ошибок.
 */
export const printFlyerSticker = (data: FlyerStickerData) => {
  const tape = data.tape || 'Тесьма 6см';
  const color = data.color || 'Белый';
  const manufacturer = data.manufacturer || 'МегаТюль';
  const count = Math.max(1, Math.min(100, data.count ?? 20));

  // Название печатаем крупно: упаковщица берёт ленту со стола и должна с одного
  // взгляда понять, к какому материалу она относится, не читая мелкий текст.
  const sticker = `
  <div class="sticker">
    <div class="title">Тюль ${esc(data.materialName)}</div>
    <div class="tape">${esc(tape)}</div>
    <div class="row">Цвет: <b>${esc(color)}</b></div>
    <div class="maker">Производитель ${esc(manufacturer)}</div>
  </div>`;

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Стикер на листовку — ${esc(data.materialName)}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
    .sticker {
      width: 58mm;
      height: 40mm;
      padding: 2mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1mm;
      overflow: hidden;
      /* Каждая наклейка — отдельная страница: принтер этикеток отрезает их по одной. */
      page-break-after: always;
    }
    /* Последней наклейке разрыв не нужен — иначе принтер вытолкнет пустую этикетку. */
    .sticker:last-child { page-break-after: auto; }
    .title {
      font-size: 12pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.1;
      /* Длинное название («Вуаль без утяжелителя») переносим, а не обрезаем. */
      overflow-wrap: anywhere;
    }
    .tape {
      font-size: 9pt;
      text-align: center;
    }
    .row {
      font-size: 9pt;
      text-align: center;
    }
    .maker {
      font-size: 8pt;
      text-align: center;
      color: #222;
      margin-top: 0.5mm;
    }
  </style>
</head>
<body>
${Array.from({ length: count }, () => sticker).join('\n')}
</body>
</html>`;

  printHtmlInIframe(html);
};

export default printFlyerSticker;
