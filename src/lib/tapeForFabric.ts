import type { Material } from '@/lib/materialsApi';

/**
 * Вуаль без утяжелителя и вся ткань на оверлоке шьются тесьмой 4 см.
 * Остальные изделия — тесьмой 6 см. На этих заказах 6 см не показываем.
 */
export const fabricUses4cmTape = (
  materialName?: string | null,
  requiresOverlock?: boolean,
): boolean => {
  if (requiresOverlock) return true;
  const n = (materialName || '').toLowerCase();
  if (n.includes('без ут')) return true;
  return n.includes('вуаль') && n.includes('без') && n.includes('утяж');
};

/** Материал справочника идёт на оверлок хотя бы в одном магазине. */
export const materialGoesThroughOverlock = (m: Pick<Material, 'requiresOverlock' | 'shops'>): boolean =>
  !!m.requiresOverlock || (m.shops || []).some((s) => s.requiresOverlock);

export const flyerTapeLabel = (materialName: string, requiresOverlock?: boolean): string =>
  fabricUses4cmTape(materialName, requiresOverlock) ? 'Тесьма 4см' : 'Тесьма 6см';

/** Название тесьмы 6 см в расходе — на заказах с 4 см строку прячем. */
export const is6cmTapeName = (name?: string | null): boolean =>
  /(^|[^0-9])6\s*(?:см|cm)/i.test(name || '');
