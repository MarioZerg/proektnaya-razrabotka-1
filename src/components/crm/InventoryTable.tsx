import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Material } from '@/lib/materialsApi';

const InventoryTable = ({ typeName, materials }: { typeName: string; materials: Material[] }) => {
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{typeName}</TableHead>
            <TableHead>Кол-во</TableHead>
            <TableHead>Рулоны</TableHead>
            <TableHead>Статус</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {materials.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>0</TableCell>
              <TableCell>0</TableCell>
              <TableCell>
                <Badge variant="secondary">В наличии</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default InventoryTable;
