import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import TablePager from '@/components/crm/finance/TablePager';
import LogsFilters from '@/components/crm/logs/LogsFilters';
import LogsSummaryTiles from '@/components/crm/logs/LogsSummaryTiles';
import LogsTable from '@/components/crm/logs/LogsTable';
import { useLogsState } from '@/components/crm/logs/useLogsState';

/** Журнал действий — что происходило в цехе: смены, раскрой, пошив, стикеровка. */
const Logs = () => {
  const s = useLogsState();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Icon name="ScrollText" size={24} />
            Журнал действий
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Кто и когда открывал смены, брал заказы, раскраивал, шил и стикеровал.
          </p>
        </div>

        <LogsSummaryTiles summary={s.summary} />

        <LogsFilters
          stage={s.stage}
          setStage={s.setStage}
          userId={s.userId}
          setUserId={s.setUserId}
          search={s.search}
          setSearch={s.setSearch}
          dateFrom={s.dateFrom}
          setDateFrom={s.setDateFrom}
          dateTo={s.dateTo}
          setDateTo={s.setDateTo}
          users={s.users}
          activeFiltersCount={s.activeFiltersCount}
          onToday={s.setToday}
          onYesterday={s.setYesterday}
          onWeek={s.setWeek}
          onReset={s.resetFilters}
          onReload={s.reload}
        />

        <LogsTable items={s.items} loading={s.loading} />

        <TablePager
          page={s.page}
          totalPages={s.totalPages}
          total={s.total}
          setPage={s.setPage}
        />
      </div>
    </CrmLayout>
  );
};

export default Logs;
