import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
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
import ErrorBoundary from '@/components/ErrorBoundary';
import ShiftQrDialog from '@/components/crm/ShiftQrDialog';
import HeaderSalaryWidget from '@/components/crm/HeaderSalaryWidget';
import StorekeeperTasksWidget from '@/components/crm/StorekeeperTasksWidget';
import { useAuth } from '@/context/AuthContext';
import { navByRole, roleLabels, isStorekeeperRole } from '@/lib/roles';
import { fetchTestAccounts, type TestAccount } from '@/lib/authApi';
import { usePickingPending } from '@/hooks/usePickingPending';
import KioskPreviewDialog from '@/components/crm/kiosk/KioskPreviewDialog';
import ContractGate from '@/components/crm/contracts/ContractGate';
import DocsGate from '@/components/crm/personal/DocsGate';
import DocsCountdownBanner from '@/components/crm/personal/DocsCountdownBanner';
import CloseSidebarOnNavigate from '@/components/crm/CloseSidebarOnNavigate';
import SidebarNav from '@/components/crm/SidebarNav';
import { fetchStartupInfo, resetStartupInfoCache } from '@/lib/authApi';

const CrmLayout = ({ children }: { children: ReactNode }) => {
  const { user, login, logout, switchRole } = useAuth();

  // Загрузка с маркетплейсов ПОЛНОСТЬЮ передана внешнему планировщику: и заказы, и заявки
  // на возврат приезжают по расписанию — круглосуточно, а не только когда кто-то открыл
  // систему. Раньше её запускал каждый открытый планшет, и одно и то же тянулось по многу
  // раз подряд. Вручную загрузка доступна кнопкой в разделе маркетплейсов.

  // Счётчик работы по подбору у кладовщика: вещи, подобранные под заказы и ждущие стикера.
  // Обновляется сам раз в минуту. По его росту кладовщик слышит голосовое уведомление —
  // он ходит между стеллажами и на экран не смотрит.
  const { pending: pickingPending } = usePickingPending(
    isStorekeeperRole(user?.role) || user?.role === 'admin',
  );

  const navigate = useNavigate();
  const location = useLocation();
  const [testAccounts, setTestAccounts] = useState<TestAccount[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [kioskPreviewOpen, setKioskPreviewOpen] = useState(false);
  // Неподписанные документы закрывают систему: пока их не подписали, вместо страниц
  // показываем экран подписания. null — ещё проверяем, не мигаем интерфейсом зря.
  const [pendingContracts, setPendingContracts] = useState<number | null>(null);

  // Срок на загрузку документов вышел, а комплекта нет — доступ приостанавливается.
  // Проверяем при входе: отдельный планировщик ради этого держать незачем.
  const [docsBlocked, setDocsBlocked] = useState(false);

  // Договоры и срок документов — ОДНИМ запросом вместо двух отдельных вызовов
  // к разным функциям. Оба вопроса про одного человека и решаются одним походом
  // в базу; раньше на каждое открытие системы уходило по два обращения.
  useEffect(() => {
    if (!user?.id) return;
    fetchStartupInfo(user.id, user.role || '')
      .then((r) => {
        setPendingContracts(r.pendingContracts);
        setDocsBlocked(r.docsBlocked);
      })
      // Если проверка не удалась (сеть, функция) — не запираем человека снаружи.
      .catch(() => {
        setPendingContracts(0);
        setDocsBlocked(false);
      });
  }, [user?.id, user?.role]);

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

  // Переключение аккаунтов — только внутри демо-режима. Администратор входит
  // в аккаунт сотрудника из раздела «Сотрудники»: там видно, кого он выбирает,
  // и это действие записывается. Дублировать его рядом с кнопкой выхода не
  // нужно — оттуда легко провалиться в чужой аккаунт случайно.
  const canSwitchAccounts = !!user?.isDemo;
  useEffect(() => {
    if (canSwitchAccounts) {
      fetchTestAccounts().then(setTestAccounts);
    }
  }, [canSwitchAccounts]);

  if (!user) {
    return null;
  }

  // Есть неподписанные документы — вместо системы показываем экран подписания.
  // Страницу «Договоры» не запираем: с неё человек и подписывает.
  if (pendingContracts !== null && pendingContracts > 0 && location.pathname !== '/crm/contracts') {
    return (
      <ContractGate
        onAllSigned={() => {
          // Ответ про договоры запомнен на несколько минут — после подписания
          // его надо забыть, иначе человек останется за той же дверью.
          resetStartupInfoCache();
          setPendingContracts(0);
        }}
      />
    );
  }

  // Документы не сданы в срок — вместо системы экран с загрузкой документов.
  // Вернуть в работу может только администратор.
  if (docsBlocked) {
    return (
      <DocsGate
        onSubmitted={() => {
          resetStartupInfoCache();
          setDocsBlocked(false);
        }}
      />
    );
  }

  const nav = navByRole[user.role] || [{ label: 'Главная', icon: 'LayoutDashboard', path: '/crm' }];
  const otherRoles = user.availableRoles.filter((r) => r !== user.role);

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
      {/* На телефоне меню выезжает поверх страницы — после выбора раздела закрываем его. */}
      <CloseSidebarOnNavigate />
      <Sidebar>
        {/* Название компании закреплено сверху: видно, в какой системе работаешь,
            и на телефоне сразу понятно, что выехало именно меню. */}
        <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
          {/* Фирменный логотип целиком: знак и светлая плашка «МЕГАТЮЛЬ». Плашка
              сама даёт светлый фон, поэтому на тёмном меню читается — отдельная
              осветлённая версия знака больше не нужна.
              Логотип широкий (545×300) и при нормальной высоте занимает почти всю
              ширину меню, поэтому ни названия, ни подписи рядом не ставим: они
              налезали бы на край. Название и так нарисовано в самом логотипе. */}
          <Link to="/crm" className="block">
            <img
              src="/assets/megatul-logo.png"
              alt="МЕГАТЮЛЬ — управление производством"
              className="h-12 w-auto max-w-full object-contain object-left"
            />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav nav={nav} pickingPending={pickingPending} />
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
            {canSwitchAccounts && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
                    aria-label="Переключить аккаунт"
                    title="Посмотреть систему глазами сотрудника"
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
        {/* Счётчик срока на документы — над всем содержимым, чтобы новичок видел его
            на любой странице, а не только там, где документы загружаются. */}
        <DocsCountdownBanner />
        {/* min-w-0 на шапке: без него виджеты с крупным балансом раздвигали
            строку и правый край уезжал за экран телефона. */}
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          <SidebarTrigger className="shrink-0" />
          {/* Персональный QR сотрудника — рядом с меню, чтобы быстро показать его сканеру. */}
          <button
            onClick={() => setQrOpen(true)}
            className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Мой QR-код"
            title="Мой QR-код"
          >
            <Icon name="QrCode" size={20} />
          </button>
          <div className="ml-auto min-w-0">
            <HeaderSalaryWidget />
          </div>
        </div>
        {/* Задания смены кладовщика — полупрозрачный список под балансом.
            Сам решает, показываться ли: только кладовщику и только при
            открытой смене. */}
        <StorekeeperTasksWidget />
        {/* Сбой внутри страницы не должен гасить меню и весь экран. */}
        <div className="p-3 sm:p-6">
          {/* key по адресу: при переходе на другую страницу защита пересоздаётся,
              иначе экран ошибки «залипал» бы и на исправных разделах. Роль в ключе —
              чтобы после переключения должности страница отрисовалась заново. */}
          <ErrorBoundary key={`${location.pathname}-${user.role}`}>{children}</ErrorBoundary>
        </div>
      </main>
    </SidebarProvider>
  );
};

export default CrmLayout;