/**
 * Открывает файл так, чтобы в адресе остался yarplan.ru.
 *
 * Прямая ссылка на хранилище уводит вкладку на чужой домен — под документом,
 * который человек печатает и отдаёт, это выглядит как чужой сервис.
 * Файл сначала скачивается в браузер и открывается из памяти: в строке адреса
 * остаётся домен системы.
 */
export const openOwnFile = async (fileUrl: string, downloadName = 'document') => {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error('Не удалось открыть документ');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
