import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import { formatMoney, mockOperations } from '@/components/crm/finance/financeShared';

const totalPages = 30745;

interface OperationsTableProps {
  page: number;
  setPage: (page: number) => void;
}

const OperationsTable = ({ page, setPage }: OperationsTableProps) => {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Тип</TableHead>
              <TableHead className="text-primary-foreground">Начислено за</TableHead>
              <TableHead className="text-primary-foreground">Сумма</TableHead>
              <TableHead className="text-primary-foreground">Название</TableHead>
              <TableHead className="text-primary-foreground">Дата создания</TableHead>
              <TableHead className="text-primary-foreground">Дата выплаты</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockOperations.map((op) => (
              <TableRow key={op.id}>
                <TableCell>{op.id}</TableCell>
                <TableCell>
                  <Icon
                    name={op.type === 'expense' ? 'MinusCircle' : 'PlusCircle'}
                    size={16}
                    className={op.type === 'expense' ? 'text-destructive' : 'text-emerald-600'}
                  />
                </TableCell>
                <TableCell>{op.accruedFor}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatMoney(op.amount)} <Icon name="Coins" size={12} className="inline" />
                </TableCell>
                <TableCell>{op.name}</TableCell>
                <TableCell className="whitespace-nowrap">{op.createdAt}</TableCell>
                <TableCell>{op.paidAt || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink onClick={() => setPage(Math.max(1, page - 1))} className="cursor-pointer">
              <Icon name="ChevronLeft" size={16} />
            </PaginationLink>
          </PaginationItem>
          {[1, 2, 3, 4, 5, 6].map((p) => (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === page}
                onClick={() => setPage(p)}
                className="cursor-pointer"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ))}
          <PaginationItem>
            <span className="px-2 text-sm text-muted-foreground">...</span>
          </PaginationItem>
          {[totalPages - 1, totalPages].map((p) => (
            <PaginationItem key={p}>
              <PaginationLink
                isActive={p === page}
                onClick={() => setPage(p)}
                className="cursor-pointer"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ))}
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
    </div>
  );
};

export default OperationsTable;
