import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS =
  'C:/Users/Home/.cursor/projects/c-Users-Home-Projects-proektnaya-razrabotka-1/assets';
const OUT = path.resolve(__dirname, '../public/warehouse-stations');

const scenes = [
  ['kiosk4-shift', 'kiosk4-shift.jpg'],
  ['kiosk4-orders', 'kiosk4-orders.jpg'],
  ['kiosk4-cutter-sheet', 'kiosk4-cutter.jpg'],
  ['kiosk4-reviews', 'kiosk4-reviews.jpg'],
  ['kiosk4-rolls', 'kiosk4-rolls.jpg'],
  ['kiosk4-unlabeled', 'kiosk4-unlabeled.jpg'],
  ['kiosk4-defect', 'kiosk4-defect.jpg'],
  ['kiosk4-repack', 'kiosk4-repack.jpg'],
  ['kiosk4-flyer', 'kiosk4-flyer.jpg'],
  ['kiosk4-vacation', 'kiosk4-vacation.jpg'],
];

await mkdir(OUT, { recursive: true });

for (const [name, file] of scenes) {
  const src = path.join(ASSETS, file);
  for (const [w, suffix] of [
    [480, '480'],
    [960, '960'],
  ]) {
    const dest = path.join(OUT, `${name}-${suffix}.webp`);
    await sharp(src).resize(w).webp({ quality: 82 }).toFile(dest);
    console.log(dest);
  }
}
