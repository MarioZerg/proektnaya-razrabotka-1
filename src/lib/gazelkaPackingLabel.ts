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
  JsBarcode(el, value, {
    format: 'CODE128',
    width: 1.6,
    height: 70,
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
          <tr><td>№ пост. на маркетплейсе:</td><td><b>${esc(supply.supplyNumber)}</b></td></tr>
          <tr><td>Клиент:</td><td><b>${esc(supply.gazelkaClientName)}</b></td></tr>
          <tr><td>Телефон:</td><td><b>${esc(supply.gazelkaClientPhone)}</b></td></tr>
        </table>
        <div class="barcode">${svgBarcode(bc)}</div>
        <div class="bcval">${esc(bc)}</div>
        <div class="boxno">
          Порядковый номер короба: <b>${boxNo} / ${total}</b>
          <span>(Всего: ${esc(String(plan.pallets ?? 0))} паллет, ${total} коробов)</span>
        </div>
      </div>`;
  }).join('');

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Упаковочный лист — заявка ${esc(String(plan.id))}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
      .label { width: 100%; padding: 24px; page-break-after: always; }
      .head { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #111; padding-bottom: 8px; }
      .logo { height: 46px; width: auto; }
      .headtext { display: flex; flex: 1; justify-content: space-between; align-items: baseline; }
      .title { font-size: 22px; font-weight: 700; }
      .zayavka { font-size: 16px; }
      .info { width: 100%; margin: 14px 0; border-collapse: collapse; font-size: 14px; }
      .info td { padding: 4px 6px; vertical-align: top; }
      .info td:first-child { color: #555; width: 45%; }
      .barcode { text-align: center; margin: 16px 0 4px; }
      .barcode svg { max-width: 100%; height: auto; }
      .bcval { text-align: center; font-family: monospace; font-size: 11px; word-break: break-all; margin-bottom: 14px; }
      .boxno { font-size: 15px; border-top: 1px solid #ccc; padding-top: 10px; }
      .boxno span { color: #555; font-size: 12px; margin-left: 6px; }
      @media print { .label { padding: 12px; } }
    </style></head><body onload="window.print()">${pages}</body></html>`);
  win.document.close();
};