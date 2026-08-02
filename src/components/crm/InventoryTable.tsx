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
              <TableCell>
                {item.warehouseQuantity} {item.unit}
              </TableCell>
              <TableCell>{item.warehouseRolls}</TableCell>
              <TableCell>
                {item.warehouseRolls > 0 ? (
                  <Badge variant="secondary">В наличии</Badge>
                ) : (
                  <Badge variant="outline">Нет на складе</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default InventoryTable;