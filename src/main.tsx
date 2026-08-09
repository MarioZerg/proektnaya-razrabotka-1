import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { setupChunkReload } from './lib/chunkReload'
import './index.css'

// Ставим до отрисовки: после обновления системы старая вкладка просит файлы, которых
// на сервере уже нет, — без этого экран загрузки застывал бы навсегда.
setupChunkReload();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

// Регистрируем служебный файл — без него систему нельзя установить на главный экран
// планшета в цехе. Делаем это после загрузки страницы, чтобы не замедлять первый вход.
// В режиме разработки не регистрируем: иначе кэш мешал бы видеть свежие правки.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Новая версия появилась, пока человек работал, — ставим её сразу, без ожидания
      // закрытия всех вкладок. Иначе на планшете месяцами живёт устаревшая оболочка.
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            installing.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      // Проверяем обновления при каждом открытии системы.
      reg.update().catch(() => {});
    }).catch(() => {
      // Установка — не критичная функция: если не вышло, система работает как обычный сайт.
    });
  });
}
