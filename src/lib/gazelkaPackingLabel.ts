import QRCode from 'qrcode';
import type { GazelkaPlan } from '@/lib/gazelkaApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

/** Данные, необходимые для генерации упаковочного листа Газельки. */
export interface PackingLabelData {
  plan: GazelkaPlan;
  supply: SupplyDetail;
  boxesCount: number;
}

const pad = (value: number | null | undefined, len: number): string =>
  String(Math.max(0, Math.trunc(Number(value) || 0))).padStart(len, '0');

/** Приводит дату (YYYY-MM-DD или ISO) к формату YYYYMMDD для штрихкода. */
const dateCompact = (date: string | null | undefined): string => {
  if (!date) return '00000000';
  const d = String(date).slice(0, 10).replace(/-/g, '');
  return d.length === 8 ? d : '00000000';
};

/** Формат даты DD.MM.YYYY для печати. */
const dateHuman = (date: string | null | undefined): string => {
  if (!date) return '—';
  const s = String(date).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}.${m}.${y}` : s;
};

/**
 * Дата отгрузки со склада — та, в которую Газелька забирает короба у нас.
 *
 * ПОЧЕМУ НЕ ПРОСТО plan.shipDate. Этой даты в ответе Газельки чаще всего нет:
 * она лежит в блоке route, а его API отдаёт не всегда (по заявке 351229 route
 * приходит пустым). Тогда на этикетке в строке «Дата отгрузки» стоял прочерк,
 * а в штрихкод уходили нули — склад не понимал, к какому рейсу короб.
 *
 * Поэтому берём запасной путь: плановую дату отгрузки, проставленную в нашей
 * поставке. Считаем в одном месте, чтобы текст на этикетке и значение в коде
 * не могли разойтись — раньше подстановка была только в коде, и этикетка всё
 * равно печаталась с прочерком.
 */
const resolveShipDate = (data: PackingLabelData): string | null =>
  data.plan.shipDate || data.supply.shipToGazelkaAt || null;

/**
 * Строит строку штрихкода короба в формате Газельки, например:
 * IDO=006632;IDZ=00335999;IDS=00005;IDM=00001;PAL=000;BOX=001;DTS=20260803;DTO=20260804;CAR=1;PLT=1
 *
 * ОТКУДА БЕРУТСЯ ЗНАЧЕНИЯ.
 * Большую часть отдаёт API Газельки (my-plans): IDO — id организации (on_behalf),
 * IDZ — номер заявки, PAL — паллеты, DTO — дата поставки, CAR — забор Газелькой.
 *
 * IDM — код маркетплейса из их же справочника (/descriptions: 1=Ozon, 2=Яндекс,
 * 4=WildBerries…). Раньше его вбивали руками, хотя заявка всегда приносит
 * marketplace_id — и человек мог ошибиться или оставить ноль. Теперь берём из
 * заявки, а ручное поле оставлено как запасной путь: если менеджер всё же ввёл
 * своё значение, оно главнее — бывают случаи, когда Газелька просит другой код.
 *
 * IDS — код склада поставки. Его в API нет ни в каком виде (эндпоинта складов у
 * Газельки тоже нет), поэтому он остаётся ручным: менеджер вводит его на карточке
 * поставки, уточнив у Газельки. Пока не введён — печать листов заблокирована.
 */
export const buildBarcodeValue = (data: PackingLabelData, boxNumber: number): string => {
  const { plan, supply } = data;
  // Код маркетплейса: ручной ввод важнее, иначе — из заявки Газельки.
  const idm = supply.gazelkaIdm || plan.marketplaceId || 0;
  const shipDate = resolveShipDate(data);
  const parts = [
    `IDO=${pad(plan.onBehalf, 6)}`,
    `IDZ=${pad(plan.id, 8)}`,
    `IDS=${pad(supply.gazelkaIds, 5)}`,
    `IDM=${pad(idm, 5)}`,
    `PAL=${pad(plan.pallets, 3)}`,
    `BOX=${pad(boxNumber, 3)}`,
    `DTS=${dateCompact(shipDate)}`,
    `DTO=${dateCompact(plan.deliveryDate)}`,
    `CAR=${plan.cargoPickup ? 1 : 0}`,
    `PLT=${plan.palleting ? 1 : 0}`,
  ];
  return parts.join(';');
};

/**
 * Рисует QR-код с данными короба.
 *
 * ПОЧЕМУ QR, А НЕ ПОЛОСКИ. В строке Газельки около сотни символов. В линейном
 * Code128 это примерно 1000 модулей: чтобы сканер уверенно читал, на модуль нужно
 * хотя бы 0,25 мм, то есть код должен быть около 254 мм в ширину. Этикетка даёт
 * максимум 112 мм — код физически не помещался.
 *
 * Пока его пытались уместить, он печатался сплюснутым: штрихи сливались в серую
 * полосу, и сканер не брал их вовсе (ровно это видно на этикетке с заявкой 351229).
 * Вёрсткой это не лечится — данных просто больше, чем помещается в линейный код.
 *
 * QR хранит те же данные в квадрате: при 28 мм на модуль приходится около 0,5 мм,
 * вчетверо больше необходимого. Плюс встроенная коррекция ошибок — код читается,
 * даже если этикетку потёрли или заклеили скотчем на складе.
 *
 * Уровень коррекции Q (~25% потерь) выбран намеренно: короба едут в кузове,
 * этикетки трутся друг о друга, и запас здесь важнее компактности.
 */
const qrCode = async (value: string): Promise<string> =>
  QRCode.toDataURL(value, {
    errorCorrectionLevel: 'Q',
    margin: 1,
    width: 600,
    color: { dark: '#000000', light: '#ffffff' },
  });

const esc = (s: string | null | undefined): string =>
  String(s ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Открывает окно печати с упаковочными листами Газельки — по одному листу на короб. */
export const printGazelkaLabels = async (data: PackingLabelData): Promise<void> => {
  const { plan, supply, boxesCount } = data;
  const total = Math.max(1, boxesCount);
  // Дата отгрузки — той же функцией, что и для кода: печатаем ровно то, что зашито
  // в QR, иначе на складе сверяют бумагу с кодом и видят разные даты.
  const shipDate = resolveShipDate(data);
  // Абсолютный URL логотипа — окно печати живёт на about:blank, относительный путь не сработает.
  const logoUrl = `${window.location.origin}/gazelka-logo.jpg`;

  // Коды рисуем заранее, до открытия окна: QR генерируется асинхронно, а вставлять
  // картинки в уже открытое окно печати нельзя — браузер вызовет print() раньше, чем
  // коды появятся, и часть этикеток уйдёт на принтер пустыми.
  const pages = (
    await Promise.all(
      Array.from({ length: total }, async (_, i) => {
        const boxNo = i + 1;
        const qr = await qrCode(buildBarcodeValue(data, boxNo));
        return `
      <div class="label">
        <table class="sheet">
          <tr><td class="k">№ заявки</td><td class="v">${esc(String(plan.id))}</td></tr>
          <tr><td class="k">Дата отгрузки:</td><td class="v">${dateHuman(shipDate)}</td></tr>
          <tr><td class="k">Склад поставки:</td><td class="v addr">${esc(plan.deliveryAddress)}</td></tr>
          <tr><td class="k">Дата поставки:</td><td class="v big">${dateHuman(plan.deliveryDate)}</td></tr>
          <tr><td class="k">Маркетплейс:</td><td class="v">${esc(plan.marketplaceLabel)}</td></tr>
          <tr><td class="k">№ пост. на маркетплейсе:</td><td class="v">${esc(supply.supplyNumber)}</td></tr>
          <tr><td class="k">Клиент:</td><td class="v">${esc(supply.gazelkaClientName)}</td></tr>
          <tr><td class="k">Телефон:</td><td class="v">${esc(supply.gazelkaClientPhone)}</td></tr>
          <tr class="codeRow">
            <td class="boxNoCell">
              <img class="logo" src="${logoUrl}" alt="Газелька" />
              <div class="boxNo">Короб ${boxNo} / ${total}</div>
              <div class="boxSub">Всего: ${esc(String(plan.pallets ?? 0))} паллет, ${total} коробов</div>
            </td>
            <td class="qrCell"><img class="qr" src="${qr}" alt="Код короба ${boxNo}" /></td>
          </tr>
        </table>
      </div>`;
      }),
    )
  ).join('');

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Упаковочный лист — заявка ${esc(String(plan.id))}</title>
    <style>
      /* Этикетка под термопринтер, дизайн как в оригинальном упаковочном листе Газельки:
         таблица с рамками (метка слева / значение справа), логотип и штрихкод строкой посередине. */
      /* РАЗМЕР ЛИСТА ЗАДАЁМ ЯВНО И ОДИНАКОВО В ДВУХ МЕСТАХ.
         @page управляет физическим листом принтера, .label — блоком на странице.
         Если они разойдутся, браузер допечатает пустое поле и сдвинет содержимое —
         этикетка поедет относительно рулона.

         landscape указан ОТДЕЛЬНО и намеренно. Лента у нас 120 мм шириной, этикетка
         75 мм в высоту. От одних лишь размеров драйвер принтера не всегда понимает
         ориентацию: он видит лист шире, чем выше, считает его повёрнутым и разворачивает
         содержимое на 90°. Именно так напечаталась этикетка заявки 351229 — текст шёл
         снизу вверх, поперёк ленты. Явное landscape снимает эту догадку у драйвера. */
      @page { size: 120mm 75mm landscape; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; }
      .label {
        width: 120mm; height: 75mm; padding: 2mm;
        page-break-after: always; overflow: hidden;
      }
      .label:last-child { page-break-after: auto; }
      .sheet { width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; }
      .sheet td { border: 0.3mm solid #000; padding: 0.3mm 1.5mm; font-size: 8pt; line-height: 1.1; }
      .sheet td.k { width: 40%; color: #000; }
      /* Длинный адрес склада рвём по слогам, иначе одна строка растягивала таблицу
         по ширине и всё содержимое уезжало за правый край этикетки. */
      .sheet td.v { font-weight: 700; overflow-wrap: anywhere; }
      .sheet td.v.big { font-size: 12pt; }
      /* АДРЕС СКЛАДА ОБРЕЗАЕМ ДВУМЯ СТРОКАМИ.
         Адреса приходят длинные, с описанием проезда («через шлагбаум, на проходной…»).
         В три строки такой адрес раздувал таблицу, и нижние строки — клиент, телефон,
         номер короба — уезжали за нижний край этикетки. Двух строк хватает, чтобы
         опознать склад, а точный адрес у водителя и так есть в заявке. */
      .sheet td.v.addr {
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; max-height: 7mm;
      }
      /* НИЖНЯЯ СТРОКА: НОМЕР КОРОБА СЛЕВА, QR СПРАВА.
         QR — квадрат, растягивать его нельзя, иначе перестанет читаться. Даём ему
         фиксированные 26 мм: при этом размере на модуль приходится ~0,5 мм, вчетверо
         больше минимума для сканера. Освободившееся место слева занимает крупный
         номер короба — по нему кладовщик сверяет коробки глазами, без сканера. */
      .codeRow td { padding: 1mm 1.5mm; height: 28mm; }
      .boxNoCell { vertical-align: middle; text-align: center; }
      .qrCell { vertical-align: middle; text-align: center; width: 30mm; padding: 1mm; }
      .logo { height: 5mm; width: auto; display: block; margin: 0 auto 1mm; }
      .boxNo { font-size: 13pt; font-weight: 700; line-height: 1.1; }
      .boxSub { font-size: 7pt; line-height: 1.1; margin-top: 0.5mm; }
      .qr { display: block; width: 26mm; height: 26mm; margin: 0 auto; }
    </style></head><body onload="window.print()">${pages}</body></html>`);
  win.document.close();
};