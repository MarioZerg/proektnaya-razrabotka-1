import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById("root")!).render(<App />);

// Регистрируем служебный файл — без него систему нельзя установить на главный экран
// планшета в цехе. Делаем это после загрузки страницы, чтобы не замедлять первый вход.
// В режиме разработки не регистрируем: иначе кэш мешал бы видеть свежие правки.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Установка — не критичная функция: если не вышло, система работает как обычный сайт.
    });
  });
}