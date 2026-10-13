/** Смешные шарджи вместо пустых инициалов, пока нет фото в ЛК. */
const FACES = [
  '/bubble-faces/01.webp',
  '/bubble-faces/02.webp',
  '/bubble-faces/03.webp',
  '/bubble-faces/04.webp',
  '/bubble-faces/05.webp',
  '/bubble-faces/06.webp',
  '/bubble-faces/07.webp',
  '/bubble-faces/08.webp',
] as const;

/** Стабильный шарж по id: один человек — одно лицо, пока не поставит аватар. */
export const bubblePlaceholderFace = (userId: number): string => {
  const n = FACES.length;
  const i = ((Math.trunc(userId) % n) + n) % n;
  return FACES[i];
};

export const personFaceUrl = (person: {
  id: number;
  avatarUrl?: string | null;
}): string => person.avatarUrl?.trim() || bubblePlaceholderFace(person.id);
