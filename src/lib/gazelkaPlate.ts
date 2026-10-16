/** Запасной номер: Газелька ставит его на заявку, пока водитель не назначен. */
export const PLACEHOLDER_PLATE = 'P303PE797';

const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
};

const plateKey = (plate: string) =>
  plate
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR_TO_LAT[ch] || ch);

/** Водитель назначен, только если номер есть и он не запасной P303PE797. */
export const driverAssigned = (plate?: string | null) =>
  !!plate && !!plate.trim() && plateKey(plate) !== PLACEHOLDER_PLATE;

/** Номер есть, но это запасная машина. */
export const isPlaceholderPlate = (plate?: string | null) =>
  !!plate && plateKey(plate) === PLACEHOLDER_PLATE;

/** Подпись машины для экрана: номер или «водитель не назначен». */
export const plateLabel = (plate?: string | null) =>
  driverAssigned(plate) ? (plate as string).toUpperCase() : 'водитель не назначен';
