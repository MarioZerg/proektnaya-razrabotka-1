import QRCode from 'qrcode';
import type { SupplyDetail, SupplyBox } from '@/lib/marketplaceSuppliesApi';

/** Формат даты DD.MM.YY для стикера WB. */
const dateShort = (date: string | null | undefined): string => {
  if (!date) return '—';
  const s = String(date).slice(0, 10);
  const [y, m, d] = s.split('-');
  return y && m && d ? `${d}.${m}.${y.slice(2)}` : s;
};

const esc = (s: string | null | undefined): string =>
  String(s ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

/** Значение QR короба: идентификатор короба WB (штрихкод короба нашей системы). */
const boxCode = (supply: SupplyDetail, box: SupplyBox): string =>
  box.barcode || `WB-${supply.id}-${box.boxNumber}`;

/**
 * Печатает стикер короба WB FBO (75×120 мм) прямо в нашей системе — по формату Wildberries:
 * заголовок FBO-WB_<штрихкод> + номер короба, крупный QR, номер поставки, плановая дата,
 * склад назначения и продавец.
 */
export const printWbBoxLabel = async (supply: SupplyDetail, box: SupplyBox): Promise<void> => {
  const code = boxCode(supply, box);
  const qrDataUrl = await QRCode.toDataURL(code, { margin: 0, width: 600, errorCorrectionLevel: 'M' });

  const boxNoLabel = String(box.boxNumber).padStart(4, '0');
  const headPrefix = supply.supplyBarcode || supply.supplyNumber || `FBO-WB_${supply.id}`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Стикер короба WB — №${box.boxNumber}</title>
    <style>
      @page { size: 75mm 120mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #000; }
      .label {
        width: 75mm; height: 120mm; padding: 5mm 5mm 4mm;
        display: flex; flex-direction: column; align-items: center;
        page-break-after: always; overflow: hidden;
      }
      .head { width: 100%; text-align: center; font-size: 14pt; font-weight: 400; line-height: 1.1; }
      .head b { font-weight: 800; }
      .kind { margin-top: 1mm; font-size: 12pt; font-weight: 700; }
      .qr { width: 46mm; height: 46mm; margin: 3mm 0 4mm; }
      .qr img { width: 100%; height: 100%; }
      .rows { width: 100%; }
      .pair { display: flex; gap: 6mm; }
      .field { margin-bottom: 3mm; }
      .field .cap { font-size: 9pt; color: #444; line-height: 1.1; }
      .field .val { font-size: 12pt; font-weight: 700; line-height: 1.15; word-break: break-word; }
    </style></head><body onload="window.print()">
    <div class="label">
      <div class="head">${esc(headPrefix)} <b>${boxNoLabel}</b></div>
      <div class="kind">${supply.ozonCargoType === 'PALLET' ? 'Палета' : 'Короб'}</div>
      <div class="qr"><img src="${qrDataUrl}" alt="QR" /></div>
      <div class="rows">
        <div class="pair">
          <div class="field" style="flex:1">
            <div class="cap">Номер поставки</div>
            <div class="val">${esc(supply.supplyNumber)}</div>
          </div>
          <div class="field" style="flex:1">
            <div class="cap">Плановая дата</div>
            <div class="val">${dateShort(supply.supplyDate)}</div>
          </div>
        </div>
        <div class="field">
          <div class="cap">Склад назначения</div>
          <div class="val">${esc(supply.cluster)}</div>
        </div>
        <div class="field">
          <div class="cap">Продавец</div>
          <div class="val">${esc(supply.gazelkaClientName)}</div>
        </div>
      </div>
    </div>
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
};
