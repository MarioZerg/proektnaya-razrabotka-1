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
  useEffect(() => {
    if (activeGroup) setOpenGroups({ [activeGroup]: true });
  }, [activeGroup]);

  // Аккордеон: раскрытие одной группы сворачивает остальные.
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => (prev[label] ? {} : { [label]: true }));

  const search = query.trim().toLowerCase();
  const visibleNav = useMemo(() => {
    if (!search) return nav;
    return nav
      .map((item) => {
        if (!item.children) {
          return item.label.toLowerCase().includes(search) ? item : null;
        }
        if (item.label.toLowerCase().includes(search)) return item;
        const children = item.children.filter((c) =>
          c.label.toLowerCase().includes(search),
        );
        return children.length ? { ...item, children } : null;
      })
      .filter((item): item is NavItem => item !== null);
  }, [nav, search]);

  return (
    <SidebarGroup className="gap-3 px-2.5 py-2">
      {/* Поиск не уезжает при прокрутке длинного меню. */}
      <div className="sticky top-0 z-10 -mx-0.5 bg-sidebar/95 px-0.5 pb-1 backdrop-blur-sm">
        <div className="relative">
          <Icon
            name="Search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-foreground/45"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти раздел…"
            className="h-10 rounded-xl border-sidebar-border/80 bg-sidebar-accent/40 pl-9 pr-9 text-sm text-sidebar-foreground shadow-none placeholder:text-sidebar-foreground/40 focus-visible:border-sidebar-ring focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-sidebar-foreground/45 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <Icon name="X" size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <SidebarGroupContent>
        <SidebarMenu className="gap-1">
          {visibleNav.length === 0 && (
            <div className="mx-1 rounded-xl border border-dashed border-sidebar-border/80 px-3 py-6 text-center">
              <Icon
                name="SearchX"
                size={20}
                className="mx-auto mb-2 text-sidebar-foreground/40"
              />
              <p className="text-sm text-sidebar-foreground/60">Ничего не найдено</p>
            </div>
          )}

          {visibleNav.map((item) => {
            if (!item.children) {
              const isActive = location.pathname === item.path;
              return (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.label}
                    className="crm-nav-item gap-2.5 rounded-xl px-2.5"
                  >
                    <Link to={item.path!}>
                      <Icon
                        name={item.icon}
                        size={18}
                        className={
                          isActive
                            ? 'shrink-0 text-emerald-300'
                            : 'shrink-0 text-sidebar-foreground/65'
                        }
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            }

            const isOpen = search ? true : openGroups[item.label] ?? false;
            const hasActiveChild = item.children.some(
              (c) => c.path === location.pathname,
            );

            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  onClick={() => toggleGroup(item.label)}
                  isActive={hasActiveChild && !isOpen}
                  tooltip={item.label}
                  className={
                    item.highlight
                      ? 'crm-nav-item gap-2.5 rounded-xl px-2.5 font-semibold text-amber-400 hover:text-amber-300'
                      : 'crm-nav-item gap-2.5 rounded-xl px-2.5'
                  }
                >
                  <Icon
                    name={item.icon}
                    size={18}
                    className={
                      item.highlight
                        ? 'shrink-0 text-amber-400'
                        : hasActiveChild
                          ? 'shrink-0 text-emerald-300'
                          : 'shrink-0 text-sidebar-foreground/65'
                    }
                  />
                  <span className="truncate">{item.label}</span>
                  <Icon
                    name="ChevronRight"
                    size={14}
                    className={`ml-auto shrink-0 text-sidebar-foreground/40 transition-transform duration-200 ${
                      isOpen ? 'rotate-90' : ''
                    }`}
                  />
                </SidebarMenuButton>

                {isOpen ? (
                  <SidebarMenuSub className="crm-nav-sub mt-1 ml-3.5 gap-0.5 border-l border-sidebar-border/70 py-1 pl-2.5">
                    {item.children.map((child) => {
                      const childActive = location.pathname === child.path;
                      return (
                        <SidebarMenuSubItem key={child.path}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={childActive}
                            className="crm-nav-sub-item rounded-lg px-2.5"
                          >
                            <Link to={child.path}>
                              <span className="truncate">{child.label}</span>
                              {child.path === '/crm/inventory/goods-picking' &&
                              pickingPending > 0 ? (
                                <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
                                  {pickingPending}
                                </span>
                              ) : null}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                ) : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default SidebarNav;
