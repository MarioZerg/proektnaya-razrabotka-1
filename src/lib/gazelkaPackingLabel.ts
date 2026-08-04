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
  // Горизонтальный штрихкод, как в оригинальном упаковочном листе Газельки.
  JsBarcode(el, value, {
    format: 'CODE128',
    width: 1.4,
    height: 60,
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
        <table class="sheet">
          <tr><td class="k">№ заявки</td><td class="v">${esc(String(plan.id))}</td></tr>
          <tr><td class="k">Дата отгрузки:</td><td class="v">${dateHuman(plan.shipDate)}</td></tr>
          <tr><td class="k">Склад поставки:</td><td class="v">${esc(plan.deliveryAddress)}</td></tr>
          <tr><td class="k">Дата поставки:</td><td class="v big">${dateHuman(plan.deliveryDate)}</td></tr>
          <tr><td class="k">Маркетплейс:</td><td class="v">${esc(plan.marketplaceLabel)}</td></tr>
          <tr><td class="k">№ пост. на маркетплейсе:</td><td class="v">${esc(supply.supplyNumber)}</td></tr>
          <tr class="codeRow">
            <td class="logoCell"><img class="logo" src="${logoUrl}" alt="Газелька" /></td>
            <td class="codeCell"><div class="barcode">${svgBarcode(bc)}</div></td>
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
      .sheet td { border: 0.3mm solid #000; padding: 0.4mm 2mm; font-size: 9pt; line-height: 1.15; }
      .sheet td.k { width: 42%; color: #000; }
      .sheet td.v { font-weight: 700; }
      .sheet td.v.big { font-size: 13pt; }
      /* Строка с логотипом и штрихкодом — без внутренних отступов, во всю ширину. */
      .codeRow td { padding: 1mm 2mm; }
      .logoCell { text-align: center; vertical-align: middle; }
      .logo { height: 13mm; width: auto; }
      .codeCell { vertical-align: middle; text-align: center; }
      .barcode { line-height: 0; }
      .barcode svg { display: block; width: 100%; height: 17mm; }
    </style></head><body onload="window.print()">${pages}</body></html>`);
  win.document.close();
};