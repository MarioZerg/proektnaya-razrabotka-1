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
import type { Material, Shop } from '@/lib/materialsApi';

interface MaterialsTableProps {
  loading: boolean;
  materials: Material[];
  pagedMaterials: Material[];
  typeById: Map<number, string>;
  /** Магазины по id — подписи меток в колонке «Магазины». */
  shopById: Map<number, Shop>;
  page: number;
  totalPages: number;
  setPage: Dispatch<SetStateAction<number>>;
  onEdit: (m: Material) => void;
  onAskDelete: (id: number) => void;
}

/** Таблица справочника материалов со страницами: строка материала, магазины и
 *  обработка края, средняя цена по рулонам и кнопки редактирования/удаления. */
const MaterialsTable = ({
  loading,
  materials,
  pagedMaterials,
  typeById,
  shopById,
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
              <TableHead className="text-primary-foreground">Магазины</TableHead>
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
                  {/* Общий признак оверлока показываем, только пока материал не
                      разведён по магазинам: иначе он противоречил бы колонке
                      магазинов, где у каждого своя обработка. */}
                  {m.requiresOverlock && !(m.shops && m.shops.length > 0) && (
                    <Badge
                      variant="outline"
                      className="ml-2 gap-1 border-fuchsia-300 bg-fuchsia-50 font-normal text-fuchsia-700"
                    >
                      <Icon name="Scissors" size={11} />
                      Оверлок
                    </Badge>
                  )}
                </TableCell>
                {/* Кому подходит материал и как там обрабатывают край. Видно списком,
                    без захода в карточку каждой ткани. */}
                <TableCell>
                  {!m.shops || m.shops.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Все магазины</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {m.shops.map((s) => {
                        const shop = shopById.get(s.shopId);
                        if (!shop) return null;
                        return (
                          <Badge
                            key={s.shopId}
                            variant="outline"
                            className={`gap-1 font-normal ${
                              s.requiresOverlock
                                ? 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700'
                                : ''
                            }`}
                          >
                            {shop.name}
                            {s.requiresOverlock && <Icon name="Scissors" size={11} />}
                          </Badge>
                        );
                      })}
                    </div>
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