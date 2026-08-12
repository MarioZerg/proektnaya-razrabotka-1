/**
 * Зона ответственности: производство, склад или их стык.
 *
 * На складе и в цехе работают разные люди, а вещи в таблицах выглядят одинаково —
 * кладовщик читал названия статусов, чтобы понять, его это работа или цеха. Цветная
 * метка отвечает на этот вопрос мгновенно, ещё до чтения текста:
 *
 *   фиолетовый — производство: вещь в цехе, отвечают закройщик, швея, упаковщица;
 *   зелёный    — склад: вещь лежит на полке или едет к покупателю, отвечает кладовщик;
 *   двухцветный — стык: вещь передают из рук в руки, и ошибка здесь дороже всего
 *                 (её легко «потерять» между цехом и складом).
 */
export type WorkZone = 'production' | 'warehouse' | 'both';

/** Подпись зоны — для подсказок и легенды. */
export const zoneLabels: Record<WorkZone, string> = {
  production: 'Производство',
  warehouse: 'Склад',
  both: 'Передача: производство → склад',
};

/**
 * Цветная полоса-маркер слева от строки или кнопки.
 *
 * Для стыка — градиент из двух цветов: видно, что в деле участвуют обе стороны.
 */
export const zoneBarClass: Record<WorkZone, string> = {
  production: 'bg-violet-500',
  warehouse: 'bg-emerald-500',
  both: 'bg-gradient-to-b from-violet-500 to-emerald-500',
};

/** Точка-маркер рядом с текстом статуса — там, где полоса не помещается. */
export const zoneDotClass: Record<WorkZone, string> = {
  production: 'bg-violet-500',
  warehouse: 'bg-emerald-500',
  both: 'bg-gradient-to-r from-violet-500 to-emerald-500',
};

/** Мягкая заливка для плиток-кнопок: цвет зоны, но не кричащий. */
export const zoneTileClass: Record<WorkZone, string> = {
  production: 'border-violet-300 bg-violet-50 hover:bg-violet-100',
  warehouse: 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100',
  both: 'border-violet-300 bg-gradient-to-r from-violet-50 to-emerald-50 hover:from-violet-100 hover:to-emerald-100',
};

/** Цвет иконки и числа на активной плитке. */
export const zoneAccentClass: Record<WorkZone, string> = {
  production: 'bg-violet-600 text-white',
  warehouse: 'bg-emerald-600 text-white',
  both: 'bg-gradient-to-br from-violet-600 to-emerald-600 text-white',
};

export const zoneTextClass: Record<WorkZone, string> = {
  production: 'text-violet-700',
  warehouse: 'text-emerald-700',
  both: 'text-violet-700',
};
