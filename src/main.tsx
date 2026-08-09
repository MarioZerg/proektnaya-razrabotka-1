import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import AppUpdateBanner from './components/AppUpdateBanner'
import { setupChunkReload } from './lib/chunkReload'
import './index.css'

// Ставим до отрисовки: после обновления системы старая вкладка просит файлы, которых
// на сервере уже нет, — без этого экран загрузки застывал бы навсегда.
setupChunkReload();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
    {/* Сообщение о новой версии — поверх всей системы, на любой странице. */}
    <AppUpdateBanner />
  </AppErrorBoundary>
);

// Регистрируем служебный файл — без него систему нельзя установить на главный экран
// планшета в цехе. Делаем это после загрузки страницы, чтобы не замедлять первый вход.
// В режиме разработки не регистрируем: иначе кэш мешал бы видеть свежие правки.
//
// Новую версию НЕ применяем молча: сотрудник может заполнять приёмку или собирать
// отгрузку, и внезапная перезагрузка стёрла бы введённое. Вместо этого показываем
// плашку с кнопкой — решает человек. Этим занимается AppUpdateBanner.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Установка — не критичная функция: если не вышло, система работает как обычный сайт.
    });
  });
}
