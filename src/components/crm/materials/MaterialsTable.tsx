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
import MaterialShopsBadges from '@/components/crm/materials/MaterialShopsBadges';
import MaterialsCards from '@/components/crm/materials/MaterialsCards';
import { isTulleTypeName } from '@/components/crm/materials/materialsSettingsShared';

interface MaterialsTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «материалов пока нет». */
  error?: string | null;
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
  /** Выбрана группа сверху — пустой список значит «в этой группе пусто», а не
   *  «справочник ещё не заведён». */
  filtered?: boolean;
}

/** Справочник материалов: на узком экране карточки, на широком — таблица в ширину. */
const MaterialsTable = ({
  loading,
  error = null,
  materials,
  pagedMaterials,
  typeById,
  shopById,
  page,
  totalPages,
  setPage,
  onEdit,
  onAskDelete,
  filtered = false,
}: MaterialsTableProps) => {
  if (loading && materials.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (materials.length === 0) {
    if (error) return null;
    return (
      <p className="text-sm text-muted-foreground">
        {filtered
          ? 'В этой группе пока нет материалов — выберите другую или добавьте новый.'
          : 'Материалов пока нет — добавьте первый.'}
      </p>
    );
  }

  return (
    <>
      {/* До lg — карточки: с боковым меню ERP таблица на md уже не влезает. */}
      <div className="lg:hidden">
        <MaterialsCards
          materials={pagedMaterials}
          typeById={typeById}
          shopById={shopById}
          onEdit={onEdit}
          onAskDelete={onAskDelete}
        />
      </div>

      <div className="hidden min-w-0 rounded-md border border-border lg:block">
        {/* min-w-0 table-fixed — без min-w-max из Table, иначе правые колонки
            уезжают за край, а overflow-hidden родителя их обрезает. */}
        <Table className="w-full min-w-0 table-fixed">
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-[34%] whitespace-normal text-primary-foreground">
                Материал
              </TableHead>
              <TableHead className="w-[28%] whitespace-normal text-primary-foreground">
                Магазины
              </TableHead>
              <TableHead className="w-[14%] whitespace-normal text-primary-foreground">
                Цена
              </TableHead>
              <TableHead className="w-[24%] whitespace-normal text-right text-primary-foreground">
                Статус
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedMaterials.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="min-w-0 whitespace-normal break-words align-top">
                  <div className="font-medium">
                    {m.name}
                    {isTulleTypeName(typeById.get(m.typeId)) &&
                      m.requiresOverlock &&
                      !(m.shops && m.shops.length > 0) && (
                        <Badge
                          variant="outline"
                          className="ml-2 gap-1 border-fuchsia-300 bg-fuchsia-50 font-normal text-fuchsia-700"
                        >
                          <Icon name="Scissors" size={11} />
                          Оверлок
                        </Badge>
                      )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {typeById.get(m.typeId) || '—'} · #{m.id}
                  </div>
                </TableCell>
                <TableCell className="min-w-0 whitespace-normal align-top">
                  <MaterialShopsBadges
                    material={m}
                    shopById={shopById}
                    typeName={typeById.get(m.typeId)}
                  />
                </TableCell>
                <TableCell className="min-w-0 whitespace-normal break-words align-top">
                  {m.avgCost > 0 ? (
                    <div>
                      <span className="tabular-nums">{m.avgCost.toFixed(2)} ₽</span>
                      <div className="text-xs text-muted-foreground">за {m.unit}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">— / {m.unit}</span>
                  )}
                </TableCell>
                <TableCell className="min-w-0 align-top">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Badge variant={m.status === 'active' ? 'secondary' : 'outline'}>
                      {m.status === 'active' ? 'Активен' : 'Архив'}
                    </Badge>
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

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
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
};

export default MaterialsTable;
