import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/** Ловит сбой внутри страницы и показывает понятный экран вместо белого.
 *
 * Зачем: React при необработанной ошибке в компоненте убирает с экрана ВСЁ дерево —
 * человек видит просто белый лист без единой кнопки, даже меню пропадает. Так было
 * на «Финансах»: одна упавшая таблица гасила весь раздел. Теперь ошибка остаётся
 * внутри страницы: меню на месте, есть кнопка обновить и уйти на главную. */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Сбой страницы:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10 text-destructive">
            <Icon name="TriangleAlert" size={28} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Не удалось открыть страницу</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Данные не загрузились. Обновите страницу — обычно это помогает.
            </p>
          </div>
          <div className="flex justify-center gap-2">
            <Button onClick={this.handleReload}>
              <Icon name="RefreshCw" size={16} className="mr-2" />
              Обновить
            </Button>
            <Button variant="secondary" onClick={() => (window.location.href = '/crm')}>
              На главную
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
