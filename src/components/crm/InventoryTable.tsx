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
import { getStockLevel, stockStatusLabel, stockStatusClass } from '@/lib/stockLevels';

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
                {item.warehouseRolls === 0 ? (
                  <Badge variant="outline">Нет на складе</Badge>
                ) : (
                  (() => {
                    // Статус остатка по метражу: до 200 пог.м — мало, до 500 — среднее,
                    // свыше 500 — нормальное значение. Заливки строки нет, только статус.
                    const level = getStockLevel(item.warehouseQuantity, item.unit);
                    return level ? (
                      <Badge variant="secondary" className={stockStatusClass[level]}>
                        {stockStatusLabel[level]}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">В наличии</Badge>
                    );
                  })()
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