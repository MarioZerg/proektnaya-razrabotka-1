export interface StickerItem {
  material: string;
  width: number;
  height: number;
}

const materials = ['Бамбук', 'Сетка', 'Лен', 'Вуаль', 'Шифон', 'Мрамор', 'Молния', 'Вуаль (без ут)'];
const widths = [200, 300, 400, 500, 600, 700, 800];
const fullHeights = [220, 225, 230, 235, 240, 245, 250, 255, 260, 265, 270, 275, 280, 285, 290, 295];
const reducedHeights = [230, 235, 240, 245, 250, 255, 260, 265, 270, 275, 280, 285, 290];

export const stickerItems: StickerItem[] = materials.flatMap((material) =>
  widths.flatMap((width) => {
    const heights = material === 'Вуаль (без ут)' ? reducedHeights : fullHeights;
    return heights.map((height) => ({ material, width, height }));
  })
);
