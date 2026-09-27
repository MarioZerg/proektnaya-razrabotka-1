const SRC = '/sounds/salary-dollar.mp3';

/**
 * Один аудиоэлемент на вкладку.
 *
 * Файл не качается при загрузке страницы: элемент появляется только в момент
 * первого открытия виджета баланса. Дальше браузер держит его в памяти, и
 * каждое следующее открытие просто ставит запись сначала — без нового запроса
 * и без второго параллельного проигрывания.
 */
let audio: HTMLAudioElement | null = null;

export const playSalaryOpenSound = () => {
  try {
    if (!audio) {
      audio = new Audio(SRC);
      audio.preload = 'none';
      audio.loop = false;
    }
    if (audio.readyState > 0) audio.currentTime = 0;
    const pending = audio.play();
    if (pending) pending.catch(() => {});
  } catch {
    // Звук не должен мешать открытию виджета.
  }
};
