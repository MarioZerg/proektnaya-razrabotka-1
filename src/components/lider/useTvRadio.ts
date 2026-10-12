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
export const useTvRadio = (): RadioStation | null => {
  const [stationId, setStationId] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingId = useRef('');

  useEffect(() => {
    let stop = false;
    let busy = false;

    const tick = () => {
      if (busy) return;
      busy = true;
      const controller = new AbortController();
      const abort = window.setTimeout(() => controller.abort(), RADIO_TIMEOUT_MS);
      fetchTvRadio(controller.signal)
        .then((id) => {
          if (!stop) setStationId(id);
        })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(abort);
          busy = false;
        });
    };
    tick();
    const timer = window.setInterval(tick, RADIO_POLL_MS);
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
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (playingId.current === station.id) return;
    playingId.current = station.id;
    audio.src = station.stream;
    void audio.play().catch(() => {
      playingId.current = '';
    });
  }, [station]);

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

  return station;
};

export default useTvRadio;
