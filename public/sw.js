/*
 * Служебный файл приложения «МЕГАТЮЛЬ».
 *
 * Нужен, чтобы систему можно было установить на главный экран планшета и телефона.
 *
 * ВАЖНО про кэш. Это рабочая ERP: заказы, остатки, смены и деньги должны быть только
 * свежими. Поэтому запросы к данным НИКОГДА не берутся из кэша — они всегда идут в сеть.
 * Кэшируем лишь саму оболочку приложения (иконки, шрифты), чтобы приложение открывалось
 * быстрее. Если интернет пропал — показываем понятное сообщение, а не пустой экран.
 *
 * Версию поднимаем при изменении правил кэширования: старый кэш при этом удаляется.
 */

const CACHE = 'megatul-shell-v6';

// Оболочка приложения: только иконки. Заглавную страницу заранее СЮДА НЕ КЛАДЁМ —
// в ней прописаны имена файлов сборки, которые меняются при каждом обновлении.
const SHELL = ['/icons/icon-192.png', '/icons/icon-512.png'];

// Последняя удачно открытая версия заглавной страницы. Сохраняем её на ходу — при
// каждом успешном открытии сайта. Если связь моргнула, отдаём эту копию: сотрудник
// видит рабочий интерфейс, а данные подтянутся сами, когда связь вернётся.
//
// Копия может оказаться устаревшей после выхода новой версии — тогда она попросит
// файлы, которых на сервере уже нет. Это не тупик: приложение ловит такую ошибку,
// чистит сохранённые копии и один раз перезагружается (см. src/lib/chunkReload.ts).
const APP_SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Если какая-то иконка не скачалась, установка не должна падать целиком.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => {
        // Сами версию НЕ применяем: сотрудник может заполнять приёмку или собирать
        // отгрузку, и перезагрузка посреди работы стёрла бы введённое. Ждём, пока
        // человек нажмёт «Обновить» в плашке — тогда придёт сообщение SKIP_WAITING.
        // Исключение — самая первая установка: там ждать нечего и нечего терять.
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          if (clients.length === 0) return self.skipWaiting();
          return undefined;
        });
      })
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

// Приложение просит применить новую версию немедленно, не дожидаясь закрытия вкладок.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Данные (заказы, смены, остатки) и любые изменения — только из сети, без кэша.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApi =
    url.hostname.includes('functions.poehali.dev') || url.pathname.startsWith('/api');
  if (isApi) return;

  // Файлы сборки не трогаем совсем: их имена меняются при каждом обновлении,
  // и любое вмешательство кэша здесь приводит к зависанию на загрузке.
  if (url.pathname.startsWith('/assets/')) return;

  // Открытие страницы. Сначала пробуем сеть — сотрудник должен получить свежую версию.
  // Но если связь моргнула, сайт НЕ должен превращаться в заглушку «нет интернета»:
  // отдаём последнюю удачную копию страницы. Приложение откроется как обычно, а данные
  // (заказы, смены, остатки) подгрузятся отдельно — они всегда идут в сеть напрямую.
  //
  // Так и было задумано: связь рвётся часто, а работать надо. Раньше любая заминка
  // дольше 8 секунд стирала весь интерфейс и показывала тупиковый экран с кнопкой
  // «Обновить» — по сути, сайт «падал» на ровном месте.
  if (request.mode === 'navigate') {
    // Ждём сервер не дольше 8 секунд: без предела браузер висит на запросе минутами,
    // и вместо страницы сотрудник видит бесконечный кружок.
    const withTimeout = (ms) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(request, { cache: 'reload' })
          .then((r) => { clearTimeout(timer); resolve(r); })
          .catch((e) => { clearTimeout(timer); reject(e); });
      });

    event.respondWith(
      withTimeout(8000)
        .then((response) => {
          // Удачно открыли — запоминаем эту версию страницы на случай обрыва связи.
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(APP_SHELL, copy));
          }
          return response;
        })
        // Сеть подвела: пробуем обычную загрузку (может взяться из памяти браузера),
        // затем — сохранённую копию страницы. Заглушку показываем только если и её нет,
        // то есть человек ни разу не открывал систему на этом устройстве.
        .catch(() => fetch(request))
        .catch(() => caches.match(APP_SHELL))
        .then(
          (response) =>
            response ||
            new Response(
              '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
                '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>Нет связи</title></head>' +
                '<body style="font-family:system-ui;display:flex;min-height:100vh;' +
                'align-items:center;justify-content:center;margin:0;background:#f3f3f1">' +
                '<div style="text-align:center;padding:24px;max-width:360px">' +
                '<h1 style="font-size:18px;margin:0 0 8px">Нет связи с интернетом</h1>' +
                '<p style="color:#666;font-size:14px;margin:0 0 16px">' +
                'Проверьте подключение и обновите страницу</p>' +
                '<button onclick="location.reload()" style="padding:10px 20px;border:0;' +
                'border-radius:6px;background:#3f4a35;color:#fff;font-size:15px">' +
                'Обновить</button></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            )
        )
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