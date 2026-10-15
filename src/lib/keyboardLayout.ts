const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";

const MAP: Record<string, string> = {};
for (let i = 0; i < RU.length; i += 1) {
  MAP[RU[i]] = EN[i];
  MAP[RU[i].toUpperCase()] = EN[i].toUpperCase();
}
MAP['Ё'] = '~';
MAP['№'] = '#';

/**
 * Сканер «печатает» код как клавиатура. Если на терминале включена русская раскладка,
 * вместо «ii123» приходит «шш123» и вещь не находится. Переводим русские буквы
 * обратно в те латинские, что стоят на тех же клавишах.
 */
export const fixScanLayout = (code: string): string => {
  if (!/[а-яё№]/i.test(code)) return code;
  return Array.from(code, (ch) => MAP[ch] ?? ch).join('');
};

export default fixScanLayout;
