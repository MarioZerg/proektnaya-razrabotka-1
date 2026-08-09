import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from '@/lib/chunkReload';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Последний рубеж: если приложение всё-таки упало, человек видит понятный экран
 * с кнопкой, а не бесконечный кружок или белую страницу.
 *
 * Отдельно разбираем случай недогруженной версии — там достаточно обновить страницу,
 * и это самая частая причина после выхода новой версии системы.
 */
class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Сбой приложения:', error, info.componentStack);
  }

  handleReload = () => {
    // Чистим сохранённую оболочку: без этого обновление вернёт ту же версию.
    const reload = () => window.location.reload();
    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .finally(reload);
    } else {
      reload();
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const outdated = isChunkLoadError(error.message || '');

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-border bg-background p-6 text-center">
          <h1 className="text-lg font-bold">
            {outdated ? 'Вышла новая версия системы' : 'Что-то пошло не так'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {outdated
              ? 'Обновите страницу, чтобы продолжить работу — данные не потеряются'
              : 'Обновите страницу. Если ошибка повторится, сообщите руководителю'}
          </p>
          <button
            onClick={this.handleReload}
            className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:opacity-90"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
