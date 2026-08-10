import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface TablePagerProps {
  page: number;
  totalPages: number;
  total: number;
  setPage: (page: number) => void;
}

/** Переключатель страниц под таблицами финансов. Прячется, если страница одна. */
const TablePager = ({ page, totalPages, total, setPage }: TablePagerProps) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-2 pt-3">
      <span className="text-xs text-muted-foreground">Всего записей: {total}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <Icon name="ChevronLeft" size={15} />
        </Button>
        <span className="text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          <Icon name="ChevronRight" size={15} />
        </Button>
      </div>
    </div>
  );
};

export default TablePager;
