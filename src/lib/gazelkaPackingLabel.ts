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
 * IDO=006632;IDZ=00335999;IDS=00005;IDM=00041;PAL=000;BOX=001;DTS=20260803;DTO=20260804;CAR=1;PLT=1
 */
export const buildBarcodeValue = (data: PackingLabelData, boxNumber: number): string => {
  const { plan, supply } = data;
  const parts = [
    `IDO=${pad(plan.onBehalf, 6)}`,
    `IDZ=${pad(plan.id, 8)}`,
    `IDS=${pad(supply.gazelkaIds, 5)}`,
    `IDM=${pad(supply.gazelkaIdm, 5)}`,
    `PAL=${pad(plan.pallets, 3)}`,
    `BOX=${pad(boxNumber, 3)}`,
    `DTS=${dateCompact(plan.shipDate)}`,
    `DTO=${dateCompact(plan.deliveryDate)}`,
    `CAR=${plan.cargoPickup ? 1 : 0}`,
    `PLT=${plan.palleting ? 1 : 0}`,
  ];
  return parts.join(';');
};

const svgBarcode = (value: string): string => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // Штрихкод печатается ВЕРТИКАЛЬНО (повёрнут на 90° в вёрстке), поэтому «длина» кода идёт
  // вдоль высоты этикетки (120 мм), а бары — толстые (width) и высокие (height), чтобы код
  // был крупным и уверенно считывался сканером.
  JsBarcode(el, value, {
    format: 'CODE128',
    width: 2,
    height: 180,
    displayValue: false,
    margin: 0,
  });
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
        <div class="top">
          <div class="head">
            <img class="logo" src="${logoUrl}" alt="Газелька" />
            <div class="headtext">
              <div class="title">Упаковочный лист</div>
              <div class="zayavka">№ заявки <b>${esc(String(plan.id))}</b></div>
            </div>
          </div>
          <table class="info">
            <tr><td>Дата отгрузки:</td><td><b>${dateHuman(plan.shipDate)}</b></td></tr>
            <tr><td>Склад поставки:</td><td><b>${esc(plan.deliveryAddress)}</b></td></tr>
            <tr><td>Дата поставки:</td><td><b>${dateHuman(plan.deliveryDate)}</b></td></tr>
            <tr><td>Маркетплейс:</td><td><b>${esc(plan.marketplaceLabel)}</b></td></tr>
            <tr><td>№ пост.:</td><td><b>${esc(supply.supplyNumber)}</b></td></tr>
            <tr><td>Клиент:</td><td><b>${esc(supply.gazelkaClientName)}</b></td></tr>
            <tr><td>Телефон:</td><td><b>${esc(supply.gazelkaClientPhone)}</b></td></tr>
          </table>
          <div class="boxno">
            Короб <b>${boxNo} / ${total}</b>
            <span>Всего: ${esc(String(plan.pallets ?? 0))} паллет, ${total} коробов</span>
          </div>
        </div>
        <div class="barwrap">
          <div class="barcode">${svgBarcode(bc)}</div>
        </div>
      </div>`;
  }).join('');

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Упаковочный лист — заявка ${esc(String(plan.id))}</title>
    <style>
      /* Этикетка под термопринтер: физический размер страницы 75x120 мм, без полей —
         так каждый короб печатается на отдельной наклейке. */
      @page { size: 75mm 120mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; }
      .label {
        width: 75mm; height: 120mm; padding: 2.5mm;
        page-break-after: always; overflow: hidden;
        display: flex; gap: 1.5mm;
      }
      .label:last-child { page-break-after: auto; }
      /* Левая колонка — весь текст, вертикально. Правая колонка — крупный штрихкод, повёрнутый
         на 90° во всю высоту этикетки. */
      .top { width: 46mm; display: flex; flex-direction: column; }
      .head { display: flex; align-items: center; gap: 1.5mm; border-bottom: 0.5mm solid #000; padding-bottom: 1.2mm; }
      .logo { height: 7mm; width: auto; }
      .headtext { display: flex; flex: 1; flex-direction: column; }
      .title { font-size: 10pt; font-weight: 700; line-height: 1.05; }
      .zayavka { font-size: 8pt; }
      .info { width: 100%; margin: 1.5mm 0; border-collapse: collapse; font-size: 7pt; }
      .info td { padding: 0.5mm 0.8mm; vertical-align: top; line-height: 1.12; }
      .info td:first-child { color: #333; width: 40%; }
      .boxno { margin-top: auto; font-size: 9pt; font-weight: 700; border-top: 0.3mm solid #000; padding-top: 1mm; }
      .boxno span { display: block; color: #333; font-size: 6.5pt; font-weight: 400; }
      /* Штрихкод: SVG рисуется горизонтально, поворачиваем на 90° — код идёт по высоте
         этикетки (120 мм), поэтому получается большим и легко сканируется. */
      .barwrap { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
      .barcode { transform: rotate(90deg); transform-origin: center; line-height: 0; }
      .barcode svg { display: block; height: 22mm; width: 112mm; }
    </style></head><body onload="window.print()">${pages}</body></html>`);
  win.document.close();
};