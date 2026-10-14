import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import {
  fetchDefectWriteoffs,
  type DefectWriteoffRow,
} from '@/lib/kioskApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const PAGE_SIZE = 50;

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

const formatTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

const roleLabel = (role: string | null) => {
  if (!role) return '—';
  return roleLabels[role as Role] || role;
};

/**
 * Журнал списаний брака.
 *
 * Новые списания здесь не заводят: закройщик (и другие роли цеха) списывает
 * кусок на терминале сканером. Страница — только история с фильтрами.
 */
const DefectWriteoff = () => {
  const [items, setItems] = useState<DefectWriteoffRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const load = () => {
    setLoading(true);
    fetchDefectWriteoffs({
      page,
      pageSize: PAGE_SIZE,
      role: roleFilter === 'all' ? undefined : roleFilter,
      userId: userFilter === 'all' ? undefined : Number(userFilter),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    })
      .then((data) => {
        setListError(null);
        setItems(data.items);
        setTotalCount(data.totalCount);
        setEmployees(data.employees);
        setRoles(data.roles);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить списания');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, roleFilter, userFilter, dateFrom, dateTo]);

  const resetFilters = () => {
    setRoleFilter('all');
    setUserFilter('all');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Списание брака</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Журнал списаний с терминала. Новые куски заводят закройщики сканером в цехе
          </p>
        </div>

        <div className="grid grid-cols-1 items-end gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">Роль</Label>
            <Select
              value={roleFilter}
              onValueChange={(v) => {
                setRoleFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все роли</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">Сотрудник</Label>
            <Select
              value={userFilter}
              onValueChange={(v) => {
                setUserFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все сотрудники</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">С</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label className="text-xs">По</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button variant="ghost" size="sm" className="justify-start lg:justify-center" onClick={resetFilters}>
            <Icon name="X" size={14} className="mr-1" />
            Сбросить
          </Button>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить списания"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : items.length === 0 ? (
          listError ? null : (
            <p className="text-sm text-muted-foreground">Списаний по выбранным фильтрам нет</p>
          )
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Роль</TableHead>
                    <TableHead className="text-primary-foreground">Сотрудник</TableHead>
                    <TableHead className="text-primary-foreground">Рулон</TableHead>
                    <TableHead className="text-primary-foreground">Дата</TableHead>
                    <TableHead className="text-primary-foreground">Время</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{roleLabel(row.userRole)}</TableCell>
                      <TableCell className="min-w-0 break-words">
                        {row.userName || '—'}
                      </TableCell>
                      <TableCell className="font-mono-tech whitespace-nowrap">
                        {row.rollId && row.rollBarcode ? (
                          <Link
                            to={`/crm/inventory/rolls/${row.rollId}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            {row.rollBarcode}
                          </Link>
                        ) : (
                          row.rollBarcode || '—'
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(row.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatTime(row.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {totalCount} записей · страница {page} из {totalPages}
              </p>
              {totalPages > 1 && (
                <Pagination>
                  <PaginationContent className="flex-wrap justify-center">
                    <PaginationItem>
                      <PaginationLink
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className={page <= 1 ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                      >
                        Назад
                      </PaginationLink>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationLink
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className={
                          page >= totalPages ? 'pointer-events-none opacity-40' : 'cursor-pointer'
                        }
                      >
                        Дальше
                      </PaginationLink>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default DefectWriteoff;
