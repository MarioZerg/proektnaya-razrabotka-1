import { useEffect } from 'react';

/**
 * Телевизор висит сутками: после выкладки новой сборки сам перезагружает /lider.
 * На обычных экранах обновление ждёт кнопку — здесь нажимать некому.
 */
export const useTvBuildWatch = () => {
  useEffect(() => {
    let stamp = '';
    const read = async () => {
      const res = await fetch(`/?tv=${Date.now()}`, { cache: 'no-store' });
      const html = await res.text();
      const m = html.match(/\/assets\/[^"' ]+\.js/);
      return m ? m[0] : '';
    };
    read()
      .then((s) => {
        stamp = s;
      })
      .catch(() => {});
    const id = window.setInterval(() => {
      read()
        .then((next) => {
          if (stamp && next && next !== stamp) window.location.reload();
        })
        .catch(() => {});
    }, 60000);
    return () => window.clearInterval(id);
  }, []);
};
