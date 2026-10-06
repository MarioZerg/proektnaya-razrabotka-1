import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Сбой внутри «Живого цеха» остаётся внутри блока.
 *
 * Без этого любая ошибка в карточке гасила всю главную администратора: React
 * убирает упавшее дерево целиком, и вместе с живым цехом пропадали все блоки.
 */
class LiveFloorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Сбой живого цеха:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="TriangleAlert" size={16} className="text-amber-500" />
          Живой цех временно не отобразился
        </div>
        <Button size="sm" variant="outline" onClick={() => this.setState({ hasError: false })}>
          <Icon name="RefreshCw" size={14} className="mr-1.5" />
          Показать снова
        </Button>
      </div>
    );
  }
}

export default LiveFloorBoundary;
