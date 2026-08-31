import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { formatQuantity } from '@/lib/formatQuantity';
import {
  getStockLevel,
  stockCellClass,
  STOCK_LOW_LIMIT,
  STOCK_MEDIUM_LIMIT,
} from '@/lib/stockLevels';
import { useAuth } from '@/context/AuthContext';

const WorkshopMaterials = () => {
  const { user } = useAuth();
  const [types, setTypes] = useState<WorkshopMaterialType[]>([]);
  const [columns, setColumns] = useState<WorkshopMaterialColumn[]>([]);
  const [activeColumn, setActiveColumn] = useState<{ workshopId: number; shiftNumber: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [materialFreeShifts, setMaterialFreeShifts] = useState<Record<string, number[]>>({});

  const load = () => {
    setLoading(true);
    fetchWorkshopMaterials()
      .then((materialsResp) => {
        setTypes(materialsResp.types);
        setColumns(materialsResp.columns);
        setActiveColumn(materialsResp.activeColumn);
        setMaterialFreeShifts(materialsResp.materialFreeShifts || {});
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

  // Швея/закройщик/упаковщик видят только столбик СВОЕГО цеха и СВОЕЙ текущей смены —
  // кладовщик и админ видят все цеха и смены без ограничений. Цех/смена берутся из
  // ТЕКУЩЕЙ открытой рабочей смены (activeWorkshopId/activeShiftNumber), с fallback на
  // штатные значения профиля, если смена не открыта — аналогично ToWorkshop.tsx.
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  const effectiveWorkshopId = user?.activeWorkshopId ?? user?.workshopId ?? null;
  const effectiveShiftNumber = user?.activeShiftNumber ?? user?.shiftNumber ?? null;

  // Смена без собственного материала (например, третья — в ней одни швеи) работает
  // тесьмой и тюлем соседних смен своего цеха. Показываем ей остатки ВСЕХ смен цеха:
  // иначе она видела бы пустую таблицу и не знала, есть ли чем работать.
  const myFreeShifts = materialFreeShifts[String(effectiveWorkshopId)] || [];
  const isMaterialFreeShift =
    effectiveShiftNumber !== null && myFreeShifts.includes(effectiveShiftNumber);

  const roleColumns = isProduction
    ? columns.filter(
        (col) =>
          col.workshopId === effectiveWorkshopId &&
          (isMaterialFreeShift ||
            col.shiftNumber === null ||
            col.shiftNumber === effectiveShiftNumber)
      )
    : columns;

  // ВКЛАДКИ ПО ЦЕХАМ.
  //
  // Кладовщик и админ видят все цеха сразу, и таблица растёт вширь: смены каждого
  // цеха идут подряд, строка не помещается в экран и приходится листать вбок,
  // теряя из виду название материала. Вкладка оставляет на экране один цех —
  // колонок мало, всё читается без прокрутки.
  const workshops = useMemo(() => {
    const seen = new Map<number, string>();
    roleColumns.forEach((c) => {
      if (!seen.has(c.workshopId)) seen.set(c.workshopId, c.workshopName);
    });
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [roleColumns]);

  const [tab, setTab] = useState('all');

  // Цех мог исчезнуть из данных (например, после перезагрузки под другой ролью) —
  // тогда возвращаемся на «Все цеха», иначе таблица оказалась бы пустой без причины.
  useEffect(() => {
    if (tab !== 'all' && !workshops.some((w) => String(w.id) === tab)) setTab('all');
  }, [workshops, tab]);

  // Одному цеху вкладки не нужны — работник и так видит только свой.
  const showTabs = workshops.length > 1;

  const visibleColumns =
    showTabs && tab !== 'all'
      ? roleColumns.filter((c) => String(c.workshopId) === tab)
      : roleColumns;

  // При выборе цеха «Итого» должно считать ПО ЭТОМУ ЦЕХУ: общая цифра по компании
  // рядом с колонками одного цеха выглядит как ошибка в остатках.
  const totalFor = (m: WorkshopMaterialType['materials'][number]) => {
    if (isProduction) {
      const own = m.cells.find(
        (c) =>
          c.workshopId === effectiveWorkshopId &&
          (c.shiftNumber === null || c.shiftNumber === effectiveShiftNumber)
      );
      return {
        quantity: own?.quantity ?? 0,
        rolls: own?.rollCount ?? 0,
        pending: own?.pendingQuantity ?? 0,
      };
    }
    if (showTabs && tab !== 'all') {
      const cells = m.cells.filter((c) => String(c.workshopId) === tab);
      return {
        quantity: cells.reduce((s, c) => s + c.quantity, 0),
        rolls: cells.reduce((s, c) => s + c.rollCount, 0),
        pending: cells.reduce((s, c) => s + (c.pendingQuantity ?? 0), 0),
      };
    }
    return {
      quantity: m.totalQuantity,
      rolls: m.totalRolls,
      pending: m.pendingQuantity ?? 0,
    };
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Материал на производстве</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Остатки материалов в цехах по сменам (рулоны со статусом «в цехе»)
          </p>
          {isMaterialFreeShift && (
            <p className="mt-1 text-sm text-muted-foreground">
              У вашей смены нет своего материала — вы работаете материалом других смен
              цеха, поэтому видите их остатки
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-300" />
              меньше {STOCK_LOW_LIMIT} пог.м
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300" />
              до {STOCK_MEDIUM_LIMIT} пог.м
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-300" />
              свыше {STOCK_MEDIUM_LIMIT} пог.м
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : types.length === 0 ? (
          <p className="text-sm text-muted-foreground">В цехах пока нет материалов</p>
        ) : (
          <div className="space-y-4">
            {showTabs && (
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="flex h-auto w-full flex-wrap justify-start">
                  <TabsTrigger value="all">Все цеха</TabsTrigger>
                  {workshops.map((w) => (
                    <TabsTrigger key={w.id} value={String(w.id)}>
                      {w.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

            {types.map((type) => (
              <div key={type.id} className="rounded-md border border-border">
                <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
                  <span className="text-sm font-semibold">{type.name}</span>
                  <Badge variant="secondary">{type.materials.length} поз.</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-full sm:w-56">Материал</TableHead>
                      {visibleColumns.map((col) => (
                        <TableHead
                          key={`${col.workshopId}-${col.shiftNumber}`}
                          className={`text-center ${isActiveColumn(col) ? 'border-x-2 border-primary' : ''}`}
                        >
                          {/* Цех в заголовке нужен только на вкладке «Все цеха»: там
                              «Смена №1» есть и в первом цехе, и во втором — без названия
                              две одинаковые колонки не различить. Когда цех выбран
                              вкладкой, его имя в каждой колонке — лишний повтор. */}
                          {!isProduction && tab === 'all' && (
                            <div className="text-xs font-normal text-muted-foreground">
                              {col.workshopName}
                            </div>
                          )}
                          {col.shiftLabel}
                        </TableHead>
                      ))}
                      <TableHead className="w-48 text-center">Итого</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {type.materials.map((m) => (
                      <TableRow key={m.materialId}>
                        <TableCell className="font-medium">{m.materialName}</TableCell>
                        {visibleColumns.map((col) => {
                          const cell = m.cells.find(
                            (c) => c.workshopId === col.workshopId && c.shiftNumber === col.shiftNumber
                          );
                          // Подсветка остатка: до 200 пог.м — красная, до 500 — жёлтая,
                          // свыше 500 — зелёная. Сразу видно, где материал заканчивается.
                          const level = cell ? getStockLevel(cell.quantity, m.unit) : null;
                          return (
                            <TableCell
                              key={`${col.workshopId}-${col.shiftNumber}`}
                              className={`text-center ${isActiveColumn(col) ? 'border-x-2 border-primary' : ''} ${
                                level ? stockCellClass[level] : cell ? 'bg-emerald-50' : ''
                              }`}
                            >
                              {cell ? `${formatQuantity(cell.quantity)} ${m.unit}, ${cell.rollCount} рул.` : '—'}
                            </TableCell>
                          );
                        })}
                        <TableCell
                          className={`text-center font-semibold ${(() => {
                            // Итог подсвечиваем по той же шкале, что и ячейки смен.
                            const lvl = getStockLevel(totalFor(m).quantity, m.unit);
                            return lvl ? stockCellClass[lvl] : '';
                          })()}`}
                        >
                          {/* Итог считается по тому, что человек сейчас видит: работнику —
                              по его смене, при выбранной вкладке — по цеху, на «Все цеха» —
                              по компании. Иначе цифра не сходилась бы с колонками рядом. */}
                          {(() => {
                            const t = totalFor(m);
                            return `${formatQuantity(t.quantity)} ${m.unit}, ${t.rolls} рул.`;
                          })()}
                          {/* Часть остатка доехала до цеха, но смена её ещё не приняла.
                              Без этой пометки материал не виден нигде: в работу он не
                              пойдёт, а в общем остатке уже учтён — цех считает, что
                              ткань есть, и планирует раскрой, которого не будет. */}
                          {totalFor(m).pending > 0 && (
                            <div className="text-xs font-medium text-amber-600">
                              в пути: {formatQuantity(totalFor(m).pending)} {m.unit}
                            </div>
                          )}
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