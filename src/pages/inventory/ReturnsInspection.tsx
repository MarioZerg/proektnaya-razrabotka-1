import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { INSPECTION_STAGES } from '@/components/crm/goodsWarehouse/inspectionStages';
import ReturnsInspectionStages from '@/components/crm/goodsWarehouse/ReturnsInspectionStages';
import ReturnsInspectionActions from '@/components/crm/goodsWarehouse/ReturnsInspectionActions';
import ReturnsInspectionList from '@/components/crm/goodsWarehouse/ReturnsInspectionList';
import { useReturnsInspection } from '@/components/crm/goodsWarehouse/useReturnsInspection';

/**
 * Возвраты на осмотре — воронка из шести этапов.
 *
 * Одна вещь идёт по цепочке: приняли с возврата → передали упаковщицам → они осмотрели
 * → кладовщик забрал из цеха → положил на полку. Брак сворачивает на утилизацию.
 * Каждый виджет — это счётчик застрявшей работы: сразу видно, где образовался затор.
 *
 * Раньше весь этот путь был невидим: вещь уезжала в цех и «пропадала» до тех пор, пока
 * кто-нибудь не находил её на столе.
 */
const ReturnsInspection = () => {
  const navigate = useNavigate();
  const {
    counts,
    items,
    stage,
    setStage,
    loading,
    selected,
    setSelected,
    acting,
    disposeReason,
    setDisposeReason,
    shelves,
    shelfId,
    setShelfId,
    search,
    setSearch,
    isAdmin,
    visible,
    toggle,
    toggleAll,
    handleMoveToWorkshop,
    handleToShelf,
    handleDispose,
    handleClear,
  } = useReturnsInspection();

  const current = INSPECTION_STAGES.find((s) => s.key === stage);

  return (
    <CrmLayout>
      <div className="space-y-6">
        {/* Возврат к складу — стрелкой над заголовком, как на других вложенных страницах.
            Раньше здесь стояла кнопка «Склад товара» в один ряд с рабочими действиями:
            навигация мешалась среди кнопок, которыми что-то делают. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/crm/inventory/goods-warehouse')}
          className="-ml-2 -mb-2"
        >
          <Icon name="ChevronLeft" size={16} className="mr-1" />
          К складу товара
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Возвраты на осмотре</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Путь возвращённой вещи от приёмки до полки
            </p>
          </div>
          {/* Кнопка «Принять осмотренные возвраты» отсюда убрана: она переехала на
              склад товара третьим шагом цепочки возвратов (привёз → разобрал →
              принял осмотренное). Эта страница показывает движение вещи, а действия
              кладовщик делает в одном месте — на складе. */}
        </div>

        <ReturnsInspectionStages counts={counts} stage={stage} onStageChange={setStage} />

        <ReturnsInspectionActions
          stage={stage}
          selected={selected}
          acting={acting}
          isAdmin={isAdmin}
          shelves={shelves}
          shelfId={shelfId}
          onShelfIdChange={setShelfId}
          disposeReason={disposeReason}
          onDisposeReasonChange={setDisposeReason}
          onMoveToWorkshop={handleMoveToWorkshop}
          onToShelf={handleToShelf}
          onDispose={handleDispose}
          onClear={handleClear}
          onClearSelection={() => setSelected([])}
        />

        {stage === 'atPackers' && !isAdmin && (
          <p className="text-sm text-muted-foreground">
            Вещи в цехе у упаковщицы. Брак отмечает она на терминале — со склада
            отправить в утилизацию нельзя
          </p>
        )}

        {stage === 'toDispose' && !isAdmin && (
          <p className="text-sm text-muted-foreground">
            Забракованные вещи ждут решения администратора. Сообщите ему об этих товарах —
            списать их может только он
          </p>
        )}

        <ReturnsInspectionList
          title={current?.title}
          loading={loading}
          items={items}
          visible={visible}
          selected={selected}
          search={search}
          onSearchChange={setSearch}
          onToggle={toggle}
          onToggleAll={toggleAll}
        />

      </div>
    </CrmLayout>
  );
};

export default ReturnsInspection;
