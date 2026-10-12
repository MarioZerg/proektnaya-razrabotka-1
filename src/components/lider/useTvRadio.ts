import { useEffect, useRef, useState } from 'react';
import { radioById, type RadioStation } from '@/lib/radioStations';
import { fetchTvRadio } from '@/lib/varikiApi';

/** Как часто телевизор спрашивает, какую волну выбрали в Тайм-кофе. */
const RADIO_POLL_MS = 8000;
/** Дольше ждать ответа незачем: следующий опрос всё равно скоро. */
const RADIO_TIMEOUT_MS = 5000;

/**
 * Волна цеха и сам звук.
 *
 * Плеер — один объект на всё время работы телевизора, а не тег на экране:
 * экран перерисовывается (нет связи, загрузка, пузыри), а музыка от этого
 * не обрывается и не начинается заново. Та же волна при следующем опросе
 * поток не трогает. Пустой ответ — звук выключается.
 *
 * Сбой функции радио телевизор не замечает: волна остаётся прежней, живой
 * цех работает дальше. Пока один опрос не вернулся, второй не уходит, чтобы
 * зависшие запросы не копились и не занимали очередь живого цеха.
 */
export const useTvRadio = (): { station: RadioStation | null; blocked: boolean } => {
  const [stationId, setStationId] = useState('');
  // Браузер не дал включить звук без нажатия: так бывает в старой программе
  // телевизора, где автозапуск звука ещё не разрешён.
  const [blocked, setBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingId = useRef('');
  // Номер опроса: каждый ответ заново проверяет, что поток играет.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stop = false;
    let busy = false;

    const poll = () => {
      if (busy) return;
      busy = true;
      const controller = new AbortController();
      const abort = window.setTimeout(() => controller.abort(), RADIO_TIMEOUT_MS);
      fetchTvRadio(controller.signal)
        .then((id) => {
          if (stop) return;
          setStationId(id);
          setTick((n) => n + 1);
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(abort);
          busy = false;
        });
    };
    poll();
    const timer = window.setInterval(poll, RADIO_POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const station = radioById(stationId);

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    if (!station) {
      if (!playingId.current) return;
      playingId.current = '';
      setBlocked(false);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (playingId.current === station.id && !audio.paused) return;
    playingId.current = station.id;
    // Поток сменился или прежний оборвался с ошибкой — подключаем заново.
    if (audio.error || audio.src !== station.stream) audio.src = station.stream;
    audio
      .play()
      .then(() => setBlocked(false))
      .catch((e: unknown) => {
        if ((e as Error)?.name === 'NotAllowedError') setBlocked(true);
      });
    // Каждый опрос заново проверяет звук: если поток встал, он запускается
    // снова, а играющий поток условие выше не трогает.
  }, [station, tick]);

  // Звук запрещён до первого нажатия — любое касание экрана, клик или
  // клавиша включают его. Дальше браузер помнит разрешение до перезапуска.
  useEffect(() => {
    if (!blocked) return;
    const unlock = () => {
      const audio = audioRef.current;
      if (!audio || !audio.src) return;
      audio
        .play()
        .then(() => setBlocked(false))
        .catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [blocked]);

  // Поток оборвался (интернет моргнул) — через несколько секунд подключаемся заново.
  useEffect(() => {
    const audio = audioRef.current;
    if (!station || !audio) return;
    let retry = 0;
    const restart = () => {
      window.clearTimeout(retry);
      retry = window.setTimeout(() => {
        if (playingId.current !== station.id) return;
        audio.src = station.stream;
        void audio.play().catch(() => undefined);
      }, 5000);
    };
    audio.addEventListener('error', restart);
    audio.addEventListener('ended', restart);
    return () => {
      window.clearTimeout(retry);
      audio.removeEventListener('error', restart);
      audio.removeEventListener('ended', restart);
    };
  }, [station]);

  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      audioRef.current = null;
      playingId.current = '';
    },
    [],
  );

  return { station, blocked };
};

export default useTvRadio;
