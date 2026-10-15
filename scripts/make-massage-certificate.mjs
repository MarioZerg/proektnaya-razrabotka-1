/**
 * Подарочный сертификат: Ахмеджанова Холида, классический массаж, 19.10.2026 17:00.
 * Стиль первого листа (фиолетовые плашки + волны), один лист, от МЕГАТЮЛЬ.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsPDF } from 'jspdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(
  process.env.USERPROFILE || __dirname,
  'Desktop',
  'Sertifikat_Ahmedzhanova_massazh_19-10-2026.pdf',
);

const PURPLE = [88, 28, 135];
const PURPLE_SOFT = [124, 58, 237];
const INK = [30, 30, 35];

const arial = fs.readFileSync('C:/Windows/Fonts/arial.ttf').toString('base64');
const arialBd = fs.readFileSync('C:/Windows/Fonts/arialbd.ttf').toString('base64');

const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
doc.addFileToVFS('arial.ttf', arial);
doc.addFileToVFS('arialbd.ttf', arialBd);
doc.addFont('arial.ttf', 'Arial', 'normal');
doc.addFont('arialbd.ttf', 'Arial', 'bold');

const W = doc.internal.pageSize.getWidth();
const H = doc.internal.pageSize.getHeight();

doc.setFillColor(255, 255, 255);
doc.rect(0, 0, W, H, 'F');
doc.setDrawColor(...PURPLE);
doc.setLineWidth(0.7);
doc.rect(8, 8, W - 16, H - 16);
doc.setLineWidth(0.25);
doc.rect(10.5, 10.5, W - 21, H - 21);

// Логотип из меню CRM (кружок), без буквы «М»
const logoPath = path.join(__dirname, '../public/assets/megatul-logo-light.png');
const logoData = fs.readFileSync(logoPath).toString('base64');
const logoSize = 22;
const logoX = 18;
const logoY = 18;
doc.setFillColor(92, 98, 83); // как bg-[#5c6253] в меню
doc.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1.2, 'F');
doc.addImage(
  `data:image/png;base64,${logoData}`,
  'PNG',
  logoX,
  logoY,
  logoSize,
  logoSize,
);

// Плашка бренда справа
doc.setFillColor(...PURPLE);
doc.roundedRect(W - 98, 20, 80, 24, 2, 2, 'F');
doc.setTextColor(255, 255, 255);
doc.setFont('Arial', 'bold');
doc.setFontSize(13);
doc.text('МЕГАТЮЛЬ', W - 58, 31, { align: 'center' });
doc.setFont('Arial', 'normal');
doc.setFontSize(8.5);
doc.text('подарок сотруднику', W - 58, 38, { align: 'center' });

// Лента «Подарочный сертификат»
const bandY = 56;
doc.setFillColor(...PURPLE);
doc.rect(20, bandY, W - 40, 24, 'F');
doc.setTextColor(255, 255, 255);
doc.setFont('Arial', 'bold');
doc.setFontSize(24);
doc.text('Подарочный СЕРТИФИКАТ', W / 2, bandY + 15.5, { align: 'center' });

// Линия с кружком
const lineY = bandY + 32;
doc.setDrawColor(...PURPLE);
doc.setLineWidth(0.5);
doc.line(42, lineY, W / 2 - 7, lineY);
doc.line(W / 2 + 7, lineY, W - 42, lineY);
doc.setFillColor(255, 255, 255);
doc.circle(W / 2, lineY, 3.4, 'FD');

// Текст
doc.setTextColor(...INK);
doc.setFont('Arial', 'normal');
doc.setFontSize(12);
doc.text('Настоящим сертификатом подтверждается, что', W / 2, 104, { align: 'center' });

doc.setFont('Arial', 'bold');
doc.setFontSize(22);
doc.setTextColor(...PURPLE);
doc.text('Ахмеджанова Холида', W / 2, 118, { align: 'center' });

doc.setFont('Arial', 'normal');
doc.setFontSize(12);
doc.setTextColor(...INK);
doc.text('приглашается на', W / 2, 131, { align: 'center' });

doc.setFont('Arial', 'bold');
doc.setFontSize(18);
doc.setTextColor(...PURPLE);
doc.text('классический массаж', W / 2, 142, { align: 'center' });

// Куда приглашается
doc.setFont('Arial', 'bold');
doc.setFontSize(12);
doc.setTextColor(...PURPLE);
doc.text('Центр доктора Бубновского', W / 2, 154, { align: 'center' });
doc.setFont('Arial', 'normal');
doc.setFontSize(9.5);
doc.setTextColor(70, 70, 80);
doc.text('Республиканская ул., 42/24, Ярославль (этаж 1)', W / 2, 161, { align: 'center' });
doc.text('пн–пт 09:00–21:00  ·  сб 09:00–16:00', W / 2, 167.5, { align: 'center' });

// Дата
const cardW = 96;
const cardH = 18;
const cardX = (W - cardW) / 2;
const cardY = 172;
doc.setFillColor(248, 244, 255);
doc.setDrawColor(...PURPLE_SOFT);
doc.setLineWidth(0.4);
doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, 'FD');
doc.setFont('Arial', 'bold');
doc.setFontSize(13);
doc.setTextColor(...PURPLE);
doc.text('19.10.2026  ·  17:00', W / 2, cardY + 11.5, { align: 'center' });

// Гильош-волны внизу
doc.setLineWidth(0.2);
for (let row = 0; row < 14; row += 1) {
  const base = H - 36 + row * 1.75;
  const shade = 155 + row * 3;
  doc.setDrawColor(shade, shade, Math.min(210, shade + 20));
  let prevX = 14;
  let prevY = base;
  for (let x = 14; x <= W - 14; x += 1.5) {
    const y =
      base +
      Math.sin((x + row * 14) / 16) * (2.8 + (row % 4) * 0.35) +
      Math.sin((x * 0.55 - row * 5) / 7) * 1.2;
    if (x > 14) doc.line(prevX, prevY, x, y);
    prevX = x;
    prevY = y;
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
doc.save(outPath);
console.log(outPath);
