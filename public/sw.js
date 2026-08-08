/*
 * Служебный файл приложения «МЕГАТЮЛЬ».
 *
 * Нужен, чтобы систему можно было установить на главный экран планшета и телефона.
 *
 * ВАЖНО про кэш. Это рабочая ERP: заказы, остатки, смены и деньги должны быть только
 * свежими. Поэтому запросы к данным НИКОГДА не берутся из кэша — они всегда идут в сеть.
 * Кэшируем лишь саму оболочку приложения (иконки, шрифты), чтобы приложение открывалось
 * быстрее. Если интернет пропал — показываем понятное сообщение, а не пустой экран.
 */

const CACHE = 'megatul-shell-v1';

// Оболочка приложения: иконки и заглавная страница. Файлы сборки сюда не кладём —
// у них меняются имена при каждом обновлении, и старые версии только мешали бы.
const SHELL = ['/', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Подчищаем кэш прошлых версий, чтобы на планшете не осталась старая оболочка.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Данные (заказы, смены, остатки) и любые изменения — только из сети, без кэша.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApi =
    url.hostname.includes('functions.poehali.dev') || url.pathname.startsWith('/api');
  if (isApi) return;

  // Переходы по страницам: сначала сеть, чтобы сотрудник видел актуальную версию.
  // Без связи — отдаём сохранённую оболочку, приложение откроется и покажет ошибку сети.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // Иконки и шрифты: берём из кэша для скорости, параллельно обновляя копию.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
