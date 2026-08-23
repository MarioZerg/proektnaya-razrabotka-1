import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

/** Постраничный переход: выкупов тысячи, на экране держим десяток. */
interface Props {
  page: number;
  pages: number;
  onPage: (updater: (p: number) => number) => void;
}

const BuyoutsPager = ({ page, pages, onPage }: Props) => {
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage((p) => p - 1)}
      >
        <Icon name="ChevronLeft" size={14} className="mr-1" />
        Назад
      </Button>
      <span className="text-sm text-muted-foreground">
        Страница {page} из {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage((p) => p + 1)}
      >
        Вперёд
        <Icon name="ChevronRight" size={14} className="ml-1" />
      </Button>
    </div>
  );
};

export default BuyoutsPager;
