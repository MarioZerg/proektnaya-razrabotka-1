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

  const cleanup = () => {
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
