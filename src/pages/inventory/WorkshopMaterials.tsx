import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import {
  fetchWorkshopMaterials,
  type WorkshopMaterialType,
  type WorkshopMaterialColumn,
} from '@/lib/workshopMaterialsApi';
import { STOCK_LOW_LIMIT, STOCK_MEDIUM_LIMIT } from '@/lib/stockLevels';
import { useAuth } from '@/context/AuthContext';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import WorkshopMaterialsCards from '@/components/crm/workshopMaterials/WorkshopMaterialsCards';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

const WorkshopMaterials = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [printing, setPrinting] = useState(false);
  const [types, setTypes] = useState<WorkshopMaterialType[]>([]);
  const [columns, setColumns] = useState<WorkshopMaterialColumn[]>([]);
  const [activeColumn, setActiveColumn] = useState<{ workshopId: number; shiftNumber: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [materialFreeShifts, setMaterialFreeShifts] = useState<Record<string, number[]>>({});

  const load = () => {
    setLoading(true);
    fetchWorkshopMaterials()
      .then((materialsResp) => {
        setListError(null);
        setTypes(materialsResp.types);
        setColumns(materialsResp.columns);
        setActiveColumn(materialsResp.activeColumn);
        setMaterialFreeShifts(materialsResp.materialFreeShifts || {});
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить остатки');
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
  const isProduction = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer' || user?.role === 'packer_returns';
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

  const [tab, setTab] = useState('');

  // Цех мог исчезнуть из данных (например, после перезагрузки под другой ролью) —
  // тогда берём первый доступный, иначе таблица оказалась бы пустой без причины.
  useEffect(() => {
    if (workshops.length === 0) return;
    if (!workshops.some((w) => String(w.id) === tab)) setTab(String(workshops[0].id));
  }, [workshops, tab]);

  // Одному цеху вкладки не нужны — работник и так видит только свой.
  const showTabs = workshops.length > 1;

  const activeTab =
    tab && (tab === 'all' || workshops.some((w) => String(w.id) === tab))
      ? tab
      : workshops[0]
        ? String(workshops[0].id)
        : 'all';

  const visibleColumns =
    showTabs && activeTab !== 'all'
      ? roleColumns.filter((c) => String(c.workshopId) === activeTab)
      : roleColumns;

  // Одна колонка смены и так показывает остаток. «Итого» рядом повторяет ту же цифру.
  const hideTotal = visibleColumns.length <= 1;

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
    if (showTabs && activeTab !== 'all') {
      const cells = m.cells.filter((c) => String(c.workshopId) === activeTab);
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

  // PDF о простое рулонов: на каждую смену — свой файл.
  const handlePrint = async (cols: WorkshopMaterialColumn[], kind: 'idle' | 'unrecorded' = 'idle') => {
    if (cols.length === 0) return;
    setPrinting(true);
    try {
      const single = new Set(cols.map((c) => c.workshopId)).size === 1;
      const wid = single ? cols[0].workshopId : undefined;
      const made =
        kind === 'idle'
          ? await (await import('@/lib/printWorkshopRollsReport')).printWorkshopRollsReport(cols, wid)
          : await (await import('@/lib/printUnrecordedCutReport')).printUnrecordedCutReport(cols, wid);
      toast({ title: made === 1 ? 'PDF сформирован' : `Сформировано файлов: ${made}`, description: 'По одному на смену' });
    } catch (e) {
      toast({
        title: 'Не удалось сформировать PDF',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <CrmLayout>
      <div className="min-w-0 space-y-4 overflow-x-hidden sm:space-y-6">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-xl font-bold">Материал на производстве</h1>
          {visibleColumns.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={printing}>
                  <Icon name={printing ? 'Loader2' : 'FileDown'} size={16} className={`mr-1.5 ${printing ? 'animate-spin' : ''}`} />
                  PDF по сменам
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {(['idle', 'unrecorded'] as const).map((kind, idx) => (
                  <div key={kind}>
                    {idx > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="flex items-center gap-2">
                      <Icon name={kind === 'idle' ? 'Timer' : 'Scissors'} size={16} />
                      {kind === 'idle' ? 'Простой рулонов' : 'Резка без записи'}
                    </DropdownMenuLabel>
                    {visibleColumns.length > 1 && (
                      <DropdownMenuItem onClick={() => handlePrint(visibleColumns, kind)}>
                        <Icon name="Files" size={16} className="mr-2" />
                        Все смены — каждая отдельным файлом
                      </DropdownMenuItem>
                    )}
                    {visibleColumns.map((c) => (
                      <DropdownMenuItem key={`${kind}-${c.workshopId}-${c.shiftNumber}`} onClick={() => handlePrint([c], kind)}>
                        <Icon name="FileText" size={16} className="mr-2" />
                        {new Set(visibleColumns.map((v) => v.workshopId)).size > 1 ? `${c.workshopName} · ` : ''}
                        {c.shiftLabel}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          </div>
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

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить остатки"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && types.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : types.length === 0 ? (
          listError ? null : (
          <p className="text-sm text-muted-foreground">В цехах пока нет материалов</p>
          )
        ) : (
          <div className="space-y-4">
            {showTabs && (
              <Tabs value={activeTab} onValueChange={setTab}>
                <TabsList className="flex h-auto w-full min-w-0 flex-wrap justify-start gap-1">
                  <TabsTrigger value="all" className="hidden sm:inline-flex">
                    Все цеха
                  </TabsTrigger>
                  {workshops.map((w) => (
                    <TabsTrigger key={w.id} value={String(w.id)} className="max-w-full truncate">
                      {w.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}

            <WorkshopMaterialsCards
              types={types}
              visibleColumns={visibleColumns}
              showWorkshopName={!isProduction && activeTab === 'all'}
              showTotal={!hideTotal}
              isActiveColumn={isActiveColumn}
              totalFor={totalFor}
            />
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default WorkshopMaterials;