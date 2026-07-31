import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { InventoryCategory } from '@/lib/inventoryApi';

const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' => {
  if (status === 'Заканчивается') return 'destructive';
  if (status === 'В наличии') return 'secondary';
  return 'default';
};

const InventoryTable = ({ category }: { category: InventoryCategory }) => {
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{category.name}</TableHead>
            <TableHead>Кол-во</TableHead>
            <TableHead>Рулоны</TableHead>
            <TableHead>Статус</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {category.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                Пока нет позиций
              </TableCell>
            </TableRow>
          ) : (
            category.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.rolls}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default InventoryTable;
