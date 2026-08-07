import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import ShiftQrDialog from '@/components/crm/ShiftQrDialog';
import HeaderSalaryWidget from '@/components/crm/HeaderSalaryWidget';
import { useAuth } from '@/context/AuthContext';
import { navByRole, roleLabels, isStorekeeperRole } from '@/lib/roles';
import { fetchTestAccounts, type TestAccount } from '@/lib/authApi';
import { useMarketplaceAutoSync } from '@/hooks/useMarketplaceAutoSync';
import { usePickingPending } from '@/hooks/usePickingPending';
import KioskPreviewDialog from '@/components/crm/kiosk/KioskPreviewDialog';
import ContractGate from '@/components/crm/contracts/ContractGate';
import { fetchPendingContracts } from '@/lib/contractsApi';

const CrmLayout = ({ children }: { children: ReactNode }) => {
  const { user, login, logout, switchRole } = useAuth();

  // Автоподгрузка с маркетплейсов, пока открыта CRM: FBS-заказы каждые 15 минут и заявки
  // на возврат раз в час. Только для управляющих ролей — админа и кладовщика (возвраты
  // принимает он).
  useMarketplaceAutoSync(
    user?.role === 'admin',
    { id: user?.id, name: user?.name },
    user?.role === 'admin' || isStorekeeperRole(user?.role),
  );

  // Счётчик работы по подбору у кладовщика: вещи, подобранные под заказы и ждущие стикера.
  // Обновляется сам каждые 30 секунд, при появлении новых — звуковой сигнал.
  const { pending: pickingPending } = usePickingPending(
    isStorekeeperRole(user?.role) || user?.role === 'admin',
  );

  const navigate = useNavigate();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [testAccounts, setTestAccounts] = useState<TestAccount[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [kioskPreviewOpen, setKioskPreviewOpen] = useState(false);
  // Неподписанные документы закрывают систему: пока их не подписали, вместо страниц
  // показываем экран подписания. null — ещё проверяем, не мигаем интерфейсом зря.
  const [pendingContracts, setPendingContracts] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    fetchPendingContracts(user.id)
      .then(setPendingContracts)
      // Если проверка не удалась (сеть, функция) — не запираем человека снаружи.
      .catch(() => setPendingContracts(0));
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user && user.availableRoles.length === 0 && location.pathname !== '/crm') {
      navigate('/crm');
    }
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    if (user?.isDemo) {
      fetchTestAccounts().then(setTestAccounts);
    }
  }, [user?.isDemo]);

  if (!user) {
    return null;
  }

  // Есть неподписанные документы — вместо системы показываем экран подписания.
  // Страницу «Договоры» не запираем: с неё человек и подписывает.
  if (pendingContracts !== null && pendingContracts > 0 && location.pathname !== '/crm/contracts') {
    return <ContractGate onAllSigned={() => setPendingContracts(0)} />;
  }

  const nav = navByRole[user.role] || [{ label: 'Главная', icon: 'LayoutDashboard', path: '/crm' }];
  const otherRoles = user.availableRoles.filter((r) => r !== user.role);

  // Аккордеон: раскрытие одной группы сворачивает остальные, чтобы меню не разворачивалось
  // всё сразу.
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => (prev[label] ? {} : { [label]: true }));

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const handleSwitchAccount = (account: TestAccount) => {
    login({ ...account, availableRoles: [account.role], isDemo: true });
    navigate('/crm');
  };

  const handleSwitchRole = (role: (typeof user.availableRoles)[number]) => {
    switchRole(role);
    navigate('/crm');
  };

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Навигация</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {nav.map((item) => {
                  if (!item.children) {
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.path}
                        >
                          <Link to={item.path!}>
                            <Icon name={item.icon} size={16} />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }

                  const isOpen = openGroups[item.label] ?? false;
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton onClick={() => toggleGroup(item.label)}>
                        <Icon name={item.icon} size={16} />
                        <span>{item.label}</span>
                        <Icon
                          name="ChevronRight"
                          size={14}
                          className={`ml-auto transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                      </SidebarMenuButton>
                      {isOpen && (
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.path}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={location.pathname === child.path}
                              >
                                <Link to={child.path}>
                                  <span>{child.label}</span>
                                  {/* Новая работа по подбору: вещь уже подобрана под заказ
                                      и ждёт, чтобы кладовщик наклеил стикер отправления. */}
                                  {child.path === '/crm/inventory/goods-picking' && pickingPending > 0 && (
                                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                                      {pickingPending}
                                    </span>
                                  )}
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          {/* Админу — быстрый вход в терминал цеха, чтобы проверить, что видит каждая
              должность на планшете в цехе. */}
          {user.role === 'admin' && (
            <button
              onClick={() => setKioskPreviewOpen(true)}
              className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Icon name="MonitorPlay" size={16} className="shrink-0" />
              <span className="truncate">Проверить киоск</span>
            </button>
          )}
          {user.isDemo && (
            <div className="mb-2 flex items-center gap-1.5 rounded-sm bg-sidebar-accent/60 px-2 py-1">
              <Icon name="FlaskConical" size={12} className="shrink-0 text-sidebar-foreground/60" />
              <p className="truncate text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
                Демо-режим
              </p>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-1 py-1">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">
                {roleLabels[user.role] || 'Должность не утверждена'}
              </p>
            </div>
            {otherRoles.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
                    aria-label="Переключить должность"
                  >
                    <Icon name="Repeat" size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Переключить должность</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {user.availableRoles.map((role) => (
                    <DropdownMenuItem
                      key={role}
                      onClick={() => handleSwitchRole(role)}
                      disabled={role === user.role}
                    >
                      <span className="flex-1 truncate">{roleLabels[role]}</span>
                      {role === user.role && <Icon name="Check" size={14} className="ml-2" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {user.isDemo && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
                    aria-label="Переключить аккаунт"
                  >
                    <Icon name="Users" size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Переключить аккаунт</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {testAccounts.map((acc) => (
                    <DropdownMenuItem
                      key={acc.id}
                      onClick={() => handleSwitchAccount(acc)}
                      disabled={acc.id === user.id}
                    >
                      <span className="flex-1 truncate">{acc.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {roleLabels[acc.role]}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <button
              onClick={handleLogout}
              className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
              aria-label="Выйти"
            >
              <Icon name="LogOut" size={16} />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <ShiftQrDialog open={qrOpen} onOpenChange={setQrOpen} />
      {user.role === 'admin' && (
        <KioskPreviewDialog
          open={kioskPreviewOpen}
          onOpenChange={setKioskPreviewOpen}
          adminName={user.name}
        />
      )}

      {/* min-w-0 обязателен: без него широкая таблица внутри распирает всю страницу,
          и на телефоне появляется горизонтальная прокрутка всего экрана вместо
          аккуратной прокрутки самой таблицы. */}
      <main className="w-full min-w-0 flex-1 overflow-x-hidden">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <SidebarTrigger />
          {/* Персональный QR сотрудника — рядом с меню, чтобы быстро показать его сканеру. */}
          <button
            onClick={() => setQrOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Мой QR-код"
            title="Мой QR-код"
          >
            <Icon name="QrCode" size={20} />
          </button>
          <div className="ml-auto">
            <HeaderSalaryWidget />
          </div>
        </div>
        <div className="p-3 sm:p-6">{children}</div>
      </main>
    </SidebarProvider>
  );
};

export default CrmLayout;