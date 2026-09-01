import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import Icon from '@/components/ui/icon';
import type { Material } from '@/lib/materialsApi';

interface MaterialsTableProps {
  loading: boolean;
  materials: Material[];
  pagedMaterials: Material[];
  typeById: Map<number, string>;
  page: number;
  totalPages: number;
  setPage: Dispatch<SetStateAction<number>>;
  onEdit: (m: Material) => void;
  onAskDelete: (id: number) => void;
}

/** Таблица справочника материалов со страницами: строка материала, метка оверлока,
 *  средняя цена по рулонам и кнопки редактирования/удаления. */
const MaterialsTable = ({
  loading,
  materials,
  pagedMaterials,
  typeById,
  page,
  totalPages,
  setPage,
  onEdit,
  onAskDelete,
}: MaterialsTableProps) => (
  <>
    {loading ? (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    ) : materials.length === 0 ? (
      <p className="text-sm text-muted-foreground">Материалов пока нет — добавьте первый.</p>
    ) : (
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Тип</TableHead>
              <TableHead className="text-primary-foreground">Название</TableHead>
              <TableHead className="text-primary-foreground">Ед.измерения</TableHead>
              <TableHead className="text-primary-foreground">Средняя цена</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedMaterials.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.id}</TableCell>
                <TableCell>{typeById.get(m.typeId) || '—'}</TableCell>
                <TableCell className="font-medium">
                  {m.name}
                  {/* Метка прямо в списке: админу видно, какие ткани идут через
                      оверлок, без открытия карточки каждой. */}
                  {m.requiresOverlock && (
                    <Badge
                      variant="outline"
                      className="ml-2 gap-1 border-fuchsia-300 bg-fuchsia-50 font-normal text-fuchsia-700"
                    >
                      <Icon name="Scissors" size={11} />
                      Оверлок
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{m.unit}</TableCell>
                {/* Средняя цена по рулонам на складе — справочно, вручную не задаётся. */}
                <TableCell>
                  {m.avgCost > 0 ? (
                    `${m.avgCost.toFixed(2)} ₽`
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={m.status === 'active' ? 'secondary' : 'outline'}>
                    {m.status === 'active' ? 'Активен' : 'Архив'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button size="icon" variant="secondary" onClick={() => onEdit(m)}>
                      <Icon name="Pencil" size={14} />
                    </Button>
                    {m.hasMovements ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button size="icon" variant="destructive" disabled>
                              <Icon name="Lock" size={14} />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          Материал участвовал в движениях по заказам — удалить нельзя
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={() => onAskDelete(m.id)}
                      >
                        <Icon name="Trash2" size={14} />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )}

    {totalPages > 1 && (
      <div className="flex items-center justify-center gap-2">
        <Button
          size="icon"
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <Icon name="ChevronLeft" size={16} />
        </Button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <Button
            key={p}
            size="icon"
            variant={p === page ? 'default' : 'outline'}
            onClick={() => setPage(p)}
          >
            {p}
          </Button>
        ))}
        <Button
          size="icon"
          variant="outline"
          disabled={page === totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          <Icon name="ChevronRight" size={16} />
        </Button>
      </div>
    )}
  </>
);

export default MaterialsTable;
