import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import RollsCards from '@/components/crm/rolls/RollsCards';
import { rollStatusLabel, statusLabels } from '@/components/crm/rolls/rollsShared';
import type { Roll } from '@/lib/rollsApi';
import type { Workshop } from '@/lib/workshopsApi';
import { formatDateTime as formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import { shiftLabel } from '@/components/crm/shipments/toWorkshopShared';

interface RollsListSectionProps {
  loading: boolean;
  /** Все рулоны, прошедшие фильтры — по ним считается «показано X из Y». */
  allFiltered: Roll[];
  /** Видимая часть списка: длинный список браузер не тянет. */
  filtered: Roll[];
  workshops: Workshop[];
  onOpen: (id: number) => void;
  onShowMore: () => void;
}

/** Список рулонов: карточки на телефоне, таблица на компьютере, догрузка частями. */
const RollsListSection = ({
  loading,
  allFiltered,
  filtered,
  workshops,
  onOpen,
  onShowMore,
}: RollsListSectionProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (allFiltered.length === 0) {
    return <p className="text-sm text-muted-foreground">Рулонов не найдено</p>;
  }

  return (
    <>
      {/* На телефоне — карточки, на компьютере привычная таблица. */}
      <div className="md:hidden">
        <RollsCards
          rolls={filtered}
          statusLabels={statusLabels}
          formatQuantity={formatQuantity}
          formatDate={formatDate}
          shiftLabel={(r) => shiftLabel(workshops, r.workshopId, r.shiftNumber)}
          onOpen={onOpen}
        />
      </div>

      <div className="hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground">Штрихкод</TableHead>
              <TableHead className="text-primary-foreground">Материал</TableHead>
              <TableHead className="text-primary-foreground">Цех</TableHead>
              <TableHead className="text-primary-foreground">Смена</TableHead>
              <TableHead className="text-primary-foreground">Остаток</TableHead>
              <TableHead className="text-primary-foreground">Недостача</TableHead>
              <TableHead className="text-primary-foreground">Создан</TableHead>
              <TableHead className="text-primary-foreground">Завершён</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.id)}>
                <TableCell>{r.id}</TableCell>
                <TableCell>
                  <Badge variant={rollStatusLabel(r.status).variant}>
                    {rollStatusLabel(r.status).label}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono-tech">{r.barcode}</TableCell>
                <TableCell>{r.materialName || '—'}</TableCell>
                <TableCell>{r.workshopName || '—'}</TableCell>
                <TableCell>{shiftLabel(workshops, r.workshopId, r.shiftNumber)}</TableCell>
                <TableCell>
                  {formatQuantity(r.remainingQuantity)} из {formatQuantity(r.initialQuantity)}{' '}
                  {r.unit}
                </TableCell>
                <TableCell>
                  {r.shortageQuantity && r.shortageQuantity > 0 ? (
                    <Badge variant="destructive" className="font-normal">
                      {formatQuantity(r.shortageQuantity)} {r.unit}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>{formatDate(r.createdAt)}</TableCell>
                <TableCell>{r.completedAt ? formatDate(r.completedAt) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Список длинный — показываем частями, иначе браузер не справляется. */}
      {allFiltered.length > filtered.length && (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-sm text-muted-foreground">
            Показано {filtered.length} из {allFiltered.length}
          </p>
          <Button variant="outline" onClick={onShowMore}>
            Показать ещё
          </Button>
        </div>
      )}
    </>
  );
};

export default RollsListSection;
