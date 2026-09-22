import JsBarcode from 'jsbarcode';
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
  // Дата отгрузки: в заявке поля route.date может не быть (Газелька отдаёт его не
  // всегда), тогда подставляем плановую дату отгрузки из нашей поставки — иначе в
  // штрихкод уходили нули, и склад не понимал, к какому рейсу относится короб.
  const shipDate = plan.shipDate || supply.shipToGazelkaAt || null;
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

const svgBarcode = (value: string): string => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(el, value, {
    format: 'CODE128',
    width: 1,
    height: 90,
    displayValue: false,
    margin: 0,
  });

  // ШТРИХКОД ТЯНЕМ ПО ШИРИНЕ ЭТИКЕТКИ, А НЕ ПО ВЫСОТЕ.
  //
  // В строке Газельки около сотни символов — это ~1025 модулей Code128. При высоте
  // 21 мм натуральная ширина такого кода выходит под 240 мм, вдвое шире самой
  // этикетки: он вылезал за поля и обрезался при печати.
  //
  // Раньше его пытался удержать max-width: 100%. Но у SVG с заданной высотой и
  // auto-шириной это не уменьшает код пропорционально, а СЖИМАЕТ его по горизонтали
  // сильнее, чем по вертикали. Узкие штрихи сливались, и сканер переставал читать —
  // то самое «стикеры не считываются», из-за которого коды IDS/IDM считали неверными.
  //
  // Поэтому убираем жёсткие размеры и ставим viewBox с preserveAspectRatio="none":
  // теперь вёрстка сама растягивает код ровно на ширину этикетки. Масштаб по
  // горизонтали одинаков для всех штрихов, их пропорции сохраняются — код читается.
  // Высота при этом задаётся отдельно и на читаемость не влияет.
  const w = el.getAttribute('width') || '1000';
  const h = el.getAttribute('height') || '90';
  el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.removeAttribute('width');
  el.removeAttribute('height');
  return new XMLSerializer().serializeToString(el);
};

const esc = (s: string | null | undefined): string =>
  String(s ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Открывает окно печати с упаковочными листами Газельки — по одному листу на короб. */
export const printGazelkaLabels = (data: PackingLabelData): void => {
  const { plan, supply, boxesCount } = data;
  const total = Math.max(1, boxesCount);
  // Абсолютный URL логотипа — окно печати живёт на about:blank, относительный путь не сработает.
  const logoUrl = `${window.location.origin}/gazelka-logo.jpg`;

  const pages = Array.from({ length: total }, (_, i) => {
    const boxNo = i + 1;
    const bc = buildBarcodeValue(data, boxNo);
    return `
      <div class="label">
        <table class="sheet">
          <tr><td class="k">№ заявки</td><td class="v">${esc(String(plan.id))}</td></tr>
          <tr><td class="k">Дата отгрузки:</td><td class="v">${dateHuman(plan.shipDate)}</td></tr>
          <tr><td class="k">Склад поставки:</td><td class="v addr">${esc(plan.deliveryAddress)}</td></tr>
          <tr><td class="k">Дата поставки:</td><td class="v big">${dateHuman(plan.deliveryDate)}</td></tr>
          <tr><td class="k">Маркетплейс:</td><td class="v">${esc(plan.marketplaceLabel)}</td></tr>
          <tr><td class="k">№ пост. на маркетплейсе:</td><td class="v">${esc(supply.supplyNumber)}</td></tr>
          <tr class="codeRow">
            <td class="codeCell" colspan="2">
              <img class="logo" src="${logoUrl}" alt="Газелька" />
              <div class="barcode">${svgBarcode(bc)}</div>
            </td>
          </tr>
          <tr><td class="k">Клиент:</td><td class="v">${esc(supply.gazelkaClientName)}</td></tr>
          <tr><td class="k">Телефон:</td><td class="v">${esc(supply.gazelkaClientPhone)}</td></tr>
          <tr><td class="k">Порядковый номер короба:</td><td class="v">${boxNo} / ${total} (Всего: ${esc(String(plan.pallets ?? 0))} паллет, ${total} коробов)</td></tr>
        </table>
      </div>`;
  }).join('');

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
         этикетка поедет относительно рулона. */
      @page { size: 120mm 75mm; margin: 0; }
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
      /* ШТРИХКОД — НА ВСЮ ШИРИНУ ЭТИКЕТКИ, ЛОГОТИП НАД НИМ.
         Раньше логотип и код делили строку пополам, и коду оставалось ~66 мм: при сотне
         символов в строке Газельки он туда не помещался физически и вылезал за поля.
         Теперь ячейка одна на всю ширину (colspan=2): код растягивается по ней ровно,
         сохраняя пропорции штрихов. */
      .codeRow td { padding: 0.8mm 1.5mm; height: 22mm; }
      .codeCell { vertical-align: middle; text-align: center; }
      .logo { height: 5mm; width: auto; display: block; margin: 0 auto 0.6mm; }
      .barcode { line-height: 0; display: block; width: 100%; }
      .barcode svg { display: block; width: 100%; height: 14mm; }
    </style></head><body onload="window.print()">${pages}</body></html>`);
  win.document.close();
};