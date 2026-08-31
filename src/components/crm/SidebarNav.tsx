import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import type { NavItem } from '@/lib/roles';

interface SidebarNavProps {
  nav: NavItem[];
  /** Сколько вещей ждёт стикера отправления — красный кружок у «Товара к подбору». */
  pickingPending: number;
}

/**
 * Боковое меню: поиск по разделам, раскрывающиеся группы, подсветка текущей страницы.
 *
 * Вынесено из общего каркаса отдельно — меню отвечает только за навигацию, а каркас
 * за шапку, футер и содержимое страницы.
 */
const SidebarNav = ({ nav, pickingPending }: SidebarNavProps) => {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  /** Группа, внутри которой лежит открытая сейчас страница. */
  const activeGroup = useMemo(
    () =>
      nav.find((item) =>
        item.children?.some((child) => child.path === location.pathname),
      )?.label,
    [nav, location.pathname],
  );

  // РАЗДЕЛ ТЕКУЩЕЙ СТРАНИЦЫ РАСКРЫВАЕТСЯ САМ.
  //
  // Раньше меню всегда открывалось полностью свёрнутым: человек заходил в поставку,
  // открывал меню и не видел, где он находится — приходилось вспоминать, в каком
  // разделе лежит страница, и раскрывать его руками на каждом переходе.
  useEffect(() => {
    if (activeGroup) setOpenGroups({ [activeGroup]: true });
  }, [activeGroup]);

  // Аккордеон: раскрытие одной группы сворачивает остальные, чтобы меню не
  // разворачивалось во весь экран и не приходилось его прокручивать.
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => (prev[label] ? {} : { [label]: true }));

  // ПОИСК ПО МЕНЮ.
  //
  // Разделов больше сорока, и нужную страницу приходилось искать глазами по всем
  // группам, помня, в какой она лежит. Теперь достаточно набрать часть названия:
  // показываем только совпавшие пункты, а группы с совпадениями раскрываем сразу.
  const search = query.trim().toLowerCase();
  const visibleNav = useMemo(() => {
    if (!search) return nav;
    return nav
      .map((item) => {
        if (!item.children) {
          return item.label.toLowerCase().includes(search) ? item : null;
        }
        // Совпало название самой группы — показываем её целиком: человек ищет
        // «Отгрузки» и должен увидеть все отгрузки, а не пустой заголовок.
        if (item.label.toLowerCase().includes(search)) return item;
        const children = item.children.filter((c) =>
          c.label.toLowerCase().includes(search),
        );
        return children.length ? { ...item, children } : null;
      })
      .filter((item): item is NavItem => item !== null);
  }, [nav, search]);

  return (
    <SidebarGroup className="gap-2">
      {/* Поиск закреплён сверху и не уезжает при прокрутке длинного меню. */}
      <div className="relative px-1">
        <Icon
          name="Search"
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sidebar-foreground/50"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по разделам"
          className="h-9 border-sidebar-border bg-sidebar-accent/50 pl-8 pr-8 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:ring-sidebar-ring"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Очистить поиск"
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sidebar-foreground/50 transition hover:text-sidebar-foreground"
          >
            <Icon name="X" size={14} />
          </button>
        )}
      </div>

      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {visibleNav.length === 0 && (
            <p className="px-2 py-3 text-sm text-sidebar-foreground/60">
              Ничего не найдено
            </p>
          )}

          {visibleNav.map((item) => {
            if (!item.children) {
              const isActive = location.pathname === item.path;
              return (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                    <Link to={item.path!} className="gap-2.5">
                      <Icon
                        name={item.icon}
                        size={17}
                        className={
                          isActive ? 'shrink-0' : 'shrink-0 text-sidebar-foreground/70'
                        }
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            }

            // При поиске группы раскрыты всегда: иначе найденное пришлось бы
            // открывать вручную, и смысл поиска терялся бы.
            const isOpen = search ? true : openGroups[item.label] ?? false;
            const hasActiveChild = item.children.some(
              (c) => c.path === location.pathname,
            );

            return (
              <SidebarMenuItem key={item.label}>
                {/* Свёрнутая группа с открытой внутри страницей подсвечивается:
                    видно, где ты находишься, даже не раскрывая её. */}
                <SidebarMenuButton
                  onClick={() => toggleGroup(item.label)}
                  isActive={hasActiveChild && !isOpen}
                  tooltip={item.label}
                  className={
                    item.highlight
                      ? 'gap-2.5 font-semibold text-amber-500 hover:text-amber-400'
                      : 'gap-2.5'
                  }
                >
                  <Icon
                    name={item.icon}
                    size={17}
                    className={
                      item.highlight
                        ? 'shrink-0 text-amber-500'
                        : hasActiveChild
                          ? 'shrink-0'
                          : 'shrink-0 text-sidebar-foreground/70'
                    }
                  />
                  <span className="truncate">{item.label}</span>
                  <Icon
                    name="ChevronRight"
                    size={14}
                    className={`ml-auto shrink-0 text-sidebar-foreground/50 transition-transform duration-200 ${
                      isOpen ? 'rotate-90' : ''
                    }`}
                  />
                </SidebarMenuButton>

                {isOpen && (
                  <SidebarMenuSub className="mt-0.5 gap-0.5">
                    {item.children.map((child) => (
                      <SidebarMenuSubItem key={child.path}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={location.pathname === child.path}
                        >
                          <Link to={child.path}>
                            <span className="truncate">{child.label}</span>
                            {/* Новая работа по подбору: вещь уже подобрана под заказ
                                и ждёт, чтобы кладовщик наклеил стикер отправления. */}
                            {child.path === '/crm/inventory/goods-picking' &&
                              pickingPending > 0 && (
                                <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
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
  );
};

export default SidebarNav;
