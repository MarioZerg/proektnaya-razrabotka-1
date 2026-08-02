// Звуки сканирования штрихкода — используются во всех местах, где сотрудник сканирует
// штрихкод/номер для добавления позиции (рулон, заказ и т.д.) в систему.
let beepAudio: HTMLAudioElement | null = null;
let errorAudio: HTMLAudioElement | null = null;

const play = (audio: HTMLAudioElement) => {
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Браузер может заблокировать автовоспроизведение без взаимодействия пользователя —
    // сканирование инициируется кликом/Enter, так что это редкий случай, просто игнорируем.
  });
};

// Успешное добавление позиции при сканировании.
export const playScanSound = () => {
  try {
    if (!beepAudio) {
      beepAudio = new Audio('/sounds/scan-beep.mp3');
    }
    play(beepAudio);
  } catch {
    // Аудио недоступно (например, в тестовом окружении) — не мешаем основной логике.
  }
};

// Ошибка сканирования (штрихкод не найден, не тот цех/смена, уже добавлен и т.д.).
export const playScanErrorSound = () => {
  try {
    if (!errorAudio) {
      errorAudio = new Audio('/sounds/scan-error.mp3');
    }
    play(errorAudio);
  } catch {
    // Аудио недоступно (например, в тестовом окружении) — не мешаем основной логике.
  }
};
