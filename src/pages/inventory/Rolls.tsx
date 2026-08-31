import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import StockValueCard from '@/components/crm/rolls/StockValueCard';
import CutterAnalysisTab from '@/components/crm/rolls/CutterAnalysisTab';
import RollCreateDialog, { type RollForm } from '@/components/crm/rolls/RollCreateDialog';
import RollsFilters from '@/components/crm/rolls/RollsFilters';
import LowStockPrintCard from '@/components/crm/rolls/LowStockPrintCard';
import RollsListSection from '@/components/crm/rolls/RollsListSection';
import { isLowStockRoll } from '@/components/crm/rolls/rollsShared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchRolls, createRoll, type Roll } from '@/lib/rollsApi';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { isStorekeeperRole } from '@/lib/roles';

const Rolls = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialTypes, setMaterialTypes] = useState<MaterialType[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [workshopFilter, setWorkshopFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [search, setSearch] = useState('');
  // Виджет «Рулоны с малым остатком» на главной ведёт сюда со ссылкой ?low=1 —
  // страница сразу открывается с включённым фильтром, и человек видит ровно те
  // рулоны, число которых стояло в виджете.
  const [searchParams, setSearchParams] = useSearchParams();
  const [lowStockOnly, setLowStockOnly] = useState(searchParams.get('low') === '1');
  // Сколько рулонов показываем сейчас. Сбрасывается при смене фильтра.
  const [visibleCount, setVisibleCount] = useState(20);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RollForm>({
    barcode: '',
    materialId: '',
    initialQuantity: '',
    workshopId: '',
    shiftNumber: '',
  });

  // Швея, закройщик и упаковщик видят рулоны только своего цеха (сервер фильтрует по
  // цеху их открытой смены) и не могут заводить новые — это работа кладовщика.
  const isProductionRole =
    user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';
  // Рулоны заводятся только приёмкой от поставщика (Отгрузки → Отгрузка от поставщика):
  // так у каждого рулона есть документ прихода, поставщик и цена. Ручное создание оставлено
  // администратору на случай исправления данных.
  const canCreateRoll = user?.role === 'admin';
  // Закупочные цены и стоимость склада видит только администратор.
  const isAdmin = user?.role === 'admin';
  // Стикеры печатает тот, кто ходит по цеху с принтером и клеит их руками:
  // кладовщик и администратор. Закройщику печатать нечего — он их читает.
  const canPrintStickers = isAdmin || isStorekeeperRole(user?.role);

  const load = () => {
    setLoading(true);
    // Справочники запрашиваем каждый сам по себе: если связь моргнула и один не дошёл,
    // список рулонов всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchMaterialsData()
      .then((materialsData) => {
        setMaterials(materialsData.materials);
        setMaterialTypes(materialsData.types);
      })
      .catch(() => {});
    fetchWorkshops().then(setWorkshops).catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchRolls({
      ...(isProductionRole && user ? { forUserId: user.id } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    })
      .then(setRolls)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Поиск по штрихкоду ищет в базе, поэтому список надо перезапросить. Ждём паузу
  // после набора: иначе запрос уходил бы на каждую букву.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Каждая производственная роль работает со своим материалом: закройщик режет тюль,
  // швея пришивает тесьму, упаковщица берёт пакеты и этикетки. Показываем в фильтре
  // только их — чужие материалы лишь мешают и провоцируют ошибки при списании.
  const roleTypeName: Record<string, string> = {
    cutter: 'Тюль',
    sewer: 'Аксессуары',
    packer: 'Упаковка',
  };
  const myTypeName = user ? roleTypeName[user.role] : undefined;
  const myTypeId = myTypeName
    ? materialTypes.find((t) => t.name === myTypeName)?.id
    : undefined;
  const filterMaterials = myTypeId
    ? materials.filter((m) => m.typeId === myTypeId)
    : materials;

  // За полтора года работы рулонов накопились тысячи. Рисовать их все разом
  // браузер не успевает — планшет в цехе просто зависал. Показываем частями,
  // кнопка внизу догружает следующие. Поиск и фильтры работают по всему списку.
  useEffect(() => {
    setVisibleCount(20);
  }, [statusFilter, materialFilter, workshopFilter, shiftFilter, search, lowStockOnly]);

  // Держим адрес в согласии с фильтром: страницу с включённым фильтром можно
  // переслать другому человеку или обновить, не потеряв отбор.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (lowStockOnly) next.set('low', '1');
    else next.delete('low');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [lowStockOnly, searchParams, setSearchParams]);

  useEffect(() => {
    setShiftFilter('all');
  }, [workshopFilter]);

  // Цех, выбранный в фильтре: из него берём названия смен.
  const filterWorkshop =
    workshopFilter === 'all' || workshopFilter === 'none'
      ? undefined
      : workshops.find((w) => String(w.id) === workshopFilter);

  const allFiltered = rolls.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (materialFilter !== 'all' && String(r.materialId) !== materialFilter) return false;
    if (workshopFilter === 'none' && r.workshopId != null) return false;
    if (workshopFilter !== 'all' && workshopFilter !== 'none'
        && String(r.workshopId ?? '') !== workshopFilter) return false;
    if (shiftFilter !== 'all' && String(r.shiftNumber ?? '') !== shiftFilter) return false;
    if (lowStockOnly && !isLowStockRoll(r)) return false;
    return true;
  });

  // Счётчик на кнопке считаем по ВСЕМ рулонам, а не по отфильтрованным: иначе
  // цифра менялась бы от других фильтров и не совпадала бы с виджетом на главной.
  const lowStockCount = rolls.filter(isLowStockRoll).length;

  const filtered = allFiltered.slice(0, visibleCount);

  const openCreate = () => {
    setForm({ barcode: '', materialId: '', initialQuantity: '', workshopId: '', shiftNumber: '' });
    setDialogOpen(true);
  };

  const selectedWorkshop = workshops.find((w) => String(w.id) === form.workshopId);

  const handleSave = async () => {
    if (!form.barcode.trim() || !form.materialId || !form.initialQuantity) return;
    // Рулон, отправляемый сразу в цех, обязан принадлежать конкретной смене — "ничейных"
    // рулонов в цехе быть не может (проверяется и на сервере, и на уровне БД).
    if (form.workshopId && !form.shiftNumber) {
      toast({ title: 'Укажите смену', description: 'При выборе цеха смена обязательна', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createRoll({
        barcode: form.barcode.trim(),
        materialId: Number(form.materialId),
        initialQuantity: Number(form.initialQuantity),
        workshopId: form.workshopId ? Number(form.workshopId) : undefined,
        shiftNumber: form.workshopId && form.shiftNumber ? Number(form.shiftNumber) : undefined,
        actorRole: user?.role,
      });
      toast({ title: 'Рулон добавлен' });
      setDialogOpen(false);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : 'Не удалось сохранить', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Рулоны материалов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isProductionRole
                ? 'Рулоны вашего цеха: остаток, статус и штрихкод'
                : canCreateRoll
                  ? 'Партии материалов со штрихкодом, остатком и статусом'
                  : 'Партии материалов со штрихкодом, остатком и статусом. Новые рулоны заводятся приёмкой в разделе «Отгрузка от поставщика»'}
            </p>
          </div>
          <RollCreateDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            canCreateRoll={canCreateRoll}
            onOpenCreate={openCreate}
            form={form}
            setForm={setForm}
            materials={materials}
            workshops={workshops}
            selectedWorkshop={selectedWorkshop}
            saving={saving}
            onSave={handleSave}
          />
        </div>

        {/* Сколько денег лежит в остатках — коммерческая информация, только админу. */}
        {isAdmin && <StockValueCard />}

        {/* Анализ по закройщицам — инструмент разбора, а не ежедневной работы,
            поэтому он на отдельной вкладке и только у администратора. */}
        <Tabs defaultValue="list" className="space-y-4">
          {isAdmin && (
            <TabsList>
              <TabsTrigger value="list">Список рулонов</TabsTrigger>
              <TabsTrigger value="cutters">Анализ закройщиков</TabsTrigger>
            </TabsList>
          )}

          <TabsContent value="list" className="space-y-6">
            <RollsFilters
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              materialFilter={materialFilter}
              setMaterialFilter={setMaterialFilter}
              workshopFilter={workshopFilter}
              setWorkshopFilter={setWorkshopFilter}
              shiftFilter={shiftFilter}
              setShiftFilter={setShiftFilter}
              search={search}
              lowStockOnly={lowStockOnly}
              setLowStockOnly={setLowStockOnly}
              lowStockCount={lowStockCount}
              setSearch={setSearch}
              filterMaterials={filterMaterials}
              workshops={workshops}
              filterWorkshop={filterWorkshop}
            />

            {/* Панель печати показываем, когда включён фильтр заканчивающихся:
                это ровно тот список, который кладовщик собирается переклеить. */}
            {canPrintStickers && lowStockOnly && (
              <LowStockPrintCard rolls={allFiltered.filter(isLowStockRoll)} />
            )}

            <RollsListSection
              loading={loading}
              allFiltered={allFiltered}
              filtered={filtered}
              workshops={workshops}
              onOpen={(id) => navigate(`/crm/inventory/rolls/${id}`)}
              onShowMore={() => setVisibleCount((n) => n + 20)}
            />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="cutters">
              <CutterAnalysisTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </CrmLayout>
  );
};

export default Rolls;
