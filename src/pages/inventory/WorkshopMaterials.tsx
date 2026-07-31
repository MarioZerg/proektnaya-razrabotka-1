import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import {
  fetchWorkshopMaterials,
  type WorkshopMaterialType,
  type WorkshopMaterialColumn,
} from '@/lib/workshopMaterialsApi';

const WorkshopMaterials = () => {
  const [types, setTypes] = useState<WorkshopMaterialType[]>([]);
  const [columns, setColumns] = useState<WorkshopMaterialColumn[]>([]);
  const [activeColumn, setActiveColumn] = useState<{ workshopId: number; shiftNumber: number | null } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchWorkshopMaterials()
      .then((materialsResp) => {
        setTypes(materialsResp.types);
        setColumns(materialsResp.columns);
        setActiveColumn(materialsResp.activeColumn);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const isActiveColumn = (col: WorkshopMaterialColumn) =>
    activeColumn !== null &&
    activeColumn.workshopId === col.workshopId &&
    activeColumn.shiftNumber === col.shiftNumber;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Материал на производстве</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Остатки материалов в цехах по сменам (рулоны со статусом «в цехе»)
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : types.length === 0 ? (
          <p className="text-sm text-muted-foreground">В цехах пока нет материалов</p>
        ) : (
          <div className="space-y-6">
            {types.map((type) => (
              <div key={type.id} className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
                  <span className="text-sm font-semibold">{type.name}</span>
                  <Badge variant="secondary">{type.materials.length} поз.</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-56">Материал</TableHead>
                      {columns.map((col) => (
                        <TableHead
                          key={`${col.workshopId}-${col.shiftNumber}`}
                          className={`text-center ${isActiveColumn(col) ? 'border-x-2 border-primary' : ''}`}
                        >
                          {col.shiftLabel}
                          {isActiveColumn(col) && (
                            <Badge variant="outline" className="ml-1.5 text-[10px]">
                              Работает
                            </Badge>
                          )}
                        </TableHead>
                      ))}
                      <TableHead className="w-48 text-center">Итого</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {type.materials.map((m) => (
                      <TableRow key={m.materialId}>
                        <TableCell className="font-medium">{m.materialName}</TableCell>
                        {columns.map((col) => {
                          const cell = m.cells.find(
                            (c) => c.workshopId === col.workshopId && c.shiftNumber === col.shiftNumber
                          );
                          return (
                            <TableCell
                              key={`${col.workshopId}-${col.shiftNumber}`}
                              className={`text-center ${isActiveColumn(col) ? 'border-x-2 border-primary' : ''} ${cell ? 'bg-emerald-50' : ''}`}
                            >
                              {cell ? `${cell.quantity} ${m.unit}, ${cell.rollCount} рул.` : '—'}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center font-semibold">
                          {m.totalQuantity} {m.unit}, {m.totalRolls} рул.
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default WorkshopMaterials;
