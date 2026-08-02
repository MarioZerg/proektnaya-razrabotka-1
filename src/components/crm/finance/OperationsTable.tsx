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
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SalaryOperation } from '@/lib/salaryApi';
import { accrualTypeLabels, formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';

interface OperationsTableProps {
  operations: SalaryOperation[];
  loading: boolean;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  onDelete: (id: number) => void;
}

const OperationsTable = ({ operations, loading, page, setPage, totalPages, onDelete }: OperationsTableProps) => {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Тип</TableHead>
              <TableHead className="text-primary-foreground">Сотрудник</TableHead>
              <TableHead className="text-primary-foreground">Начислено за</TableHead>
              <TableHead className="text-primary-foreground">Сумма</TableHead>
              <TableHead className="text-primary-foreground">Описание</TableHead>
              <TableHead className="text-primary-foreground">Дата создания</TableHead>
              <TableHead className="text-primary-foreground">Дата выплаты</TableHead>
              <TableHead className="text-primary-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  <Icon name="Loader2" size={16} className="mr-2 inline animate-spin" />
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : operations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Начислений пока нет
                </TableCell>
              </TableRow>
            ) : (
              operations.map((op) => (
                <TableRow key={op.id}>
                  <TableCell>{op.id}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Icon
                        name={op.amount < 0 ? 'MinusCircle' : 'PlusCircle'}
                        size={14}
                        className={op.amount < 0 ? 'text-destructive' : 'text-emerald-600'}
                      />
                      <span className="text-xs">{accrualTypeLabels[op.type] || op.type}</span>
                    </div>
                  </TableCell>
                  <TableCell>{op.userName}</TableCell>
                  <TableCell>{op.accruedFor}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatMoney(op.amount)} ₽</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={op.description}>
                    {op.orderNumber ? `Заказ #${op.orderNumber} — ` : ''}
                    {op.description}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(op.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{op.paidAt ? formatDateTime(op.paidAt) : '—'}</TableCell>
                  <TableCell>
                    {op.orderNumber && !op.paidAt && (
                      <Button variant="ghost" size="icon" onClick={() => onDelete(op.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
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
      )}
    </div>
  );
};

export default OperationsTable;
