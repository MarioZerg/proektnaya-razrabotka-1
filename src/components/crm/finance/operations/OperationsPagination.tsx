import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';

interface OperationsPaginationProps {
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
}

/** Листание начислений по дням. */
const OperationsPagination = ({ page, setPage, totalPages }: OperationsPaginationProps) => (
  <Pagination>
    <PaginationContent>
      <PaginationItem>
        <PaginationLink onClick={() => setPage(Math.max(1, page - 1))} className="cursor-pointer">
          <Icon name="ChevronLeft" size={16} />
        </PaginationLink>
      </PaginationItem>
      <PaginationItem>
        <span className="px-3 text-sm text-muted-foreground">
          {page} / {totalPages}
          <span className="ml-1 text-xs">(по дням)</span>
        </span>
      </PaginationItem>
      <PaginationItem>
        <PaginationLink
          onClick={() => setPage(Math.min(totalPages, page + 1))}
          className="cursor-pointer"
        >
          <Icon name="ChevronRight" size={16} />
        </PaginationLink>
      </PaginationItem>
    </PaginationContent>
  </Pagination>
);

export default OperationsPagination;
