/**
 * Печать через скрытый iframe — без новых вкладок и окон.
 *
 * На терминале в цехе новое окно неудобно: планшет открывает вкладку поверх киоска,
 * упаковщица теряет из виду заказ, а всплывающие окна к тому же часто блокируются
 * браузером. Здесь документ рисуется в невидимом iframe внутри текущей страницы,
 * браузер показывает обычный диалог печати, а после печати iframe удаляется —
 * терминал остаётся на том же экране.
 */
export const printHtmlInIframe = (html: string) => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  // Убираем iframe РОВНО ОДИН РАЗ, откуда бы ни пришёл сигнал.
  //
  // onafterprint приходит не всегда: часть планшетных браузеров его вовсе не
  // шлёт, а если диалог печати закрыть крестиком — не шлёт почти никто. Без
  // страховки по таймеру такие iframe копились в странице до перезагрузки
  // терминала, и каждый следующий стикер печатался медленнее предыдущего.
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    // Если браузер промолчал — уберём сами через минуту. Дольше диалог печати
    // не живёт, а держать мусор в DOM незачем.
    setTimeout(cleanup, 60000);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
};

export default printHtmlInIframe;