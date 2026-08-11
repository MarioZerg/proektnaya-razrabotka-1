import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Role } from '@/lib/roles';
import { checkAccess } from '@/lib/authApi';

export interface User {
  id: number;
  name: string;
  role: Role;
  /** Все утверждённые администратором должности пользователя — для переключателя ролей. */
  availableRoles: Role[];
  /** Штатные цех/смена из профиля — не меняются гостевым входом. */
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
  isDemo?: boolean;
  /** Цех/смена ТЕКУЩЕЙ открытой смены (может отличаться от штатной, если сотрудник вошёл
   * гостем в другую смену) — именно они используются для фильтрации доступных материалов
   * при раскрое/сборке, пока смена открыта. Пока смена не открыта — null. */
  activeWorkshopId?: number | null;
  activeShiftNumber?: number | null;
  /** Админ смотрит панель этого сотрудника его глазами. Пока флаг стоит, наверху
   * висит полоса с кнопкой возврата, чтобы никто не забыл, в чьём аккаунте работает. */
  isImpersonated?: boolean;
}

interface AuthContextValue {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  switchRole: (role: Role) => void;
  setActiveShift: (workshopId: number | null, shiftNumber: number | null) => void;
  /** Войти в аккаунт сотрудника, запомнив свой. */
  impersonate: (target: User) => void;
  /** Вернуться в свой аккаунт администратора. */
  stopImpersonation: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'megatul_user';
/** Аккаунт администратора, отложенный на время просмотра чужой панели. */
const ADMIN_BACKUP_KEY = 'megatul_admin_backup';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  });

  const login = (u: User) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ADMIN_BACKUP_KEY);
    setUser(null);
  };

  // Админ уходит смотреть панель сотрудника. Свой аккаунт откладываем отдельно,
  // чтобы вернуться одной кнопкой и не логиниться заново.
  const impersonate = (target: User) => {
    setUser((prev) => {
      if (prev && !prev.isImpersonated) {
        localStorage.setItem(ADMIN_BACKUP_KEY, JSON.stringify(prev));
      }
      const next = { ...target, isImpersonated: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const stopImpersonation = () => {
    const raw = localStorage.getItem(ADMIN_BACKUP_KEY);
    if (!raw) return;
    const admin = JSON.parse(raw) as User;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
    localStorage.removeItem(ADMIN_BACKUP_KEY);
    setUser(admin);
  };

  const switchRole = (role: Role) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, role };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Вызывается после открытия/закрытия смены — фиксирует ФАКТИЧЕСКИЙ цех/смену текущей
  // рабочей сессии (может отличаться от штатных workshopId/shiftNumber в гостевом режиме).
  const setActiveShift = (workshopId: number | null, shiftNumber: number | null) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, activeWorkshopId: workshopId, activeShiftNumber: shiftNumber };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  /**
   * Сверка доступа с сервером.
   *
   * Сотрудник входит один раз и работает без выхода — это осознанное решение: в цехе
   * терминал общий, а вспоминать пароль каждую смену неудобно. Но раз выхода нет,
   * доступ должен уметь отзываться: как только администратор отключит учётную запись
   * или снимет должность, приложение выйдет само.
   *
   * Проверяем при запуске и раз в 30 минут, и только пока приложением пользуются:
   * в свёрнутой вкладке проверять нечего — нажать там всё равно ничего нельзя, а
   * отозванный доступ сработает сразу, как только на экран снова посмотрят.
   * Если сервер недоступен, работу не прерываем: в цехе связь может пропадать, а
   * из-за этого нельзя терять рабочую сессию.
   */
  useEffect(() => {
    if (!user || user.isDemo) return;

    let stopped = false;
    const verify = async () => {
      try {
        const res = await checkAccess(user.id, user.role);
        if (!stopped && res.active === false) {
          // Админ смотрит чужую панель, а у сотрудника отозвали доступ — возвращаем
          // администратора в его аккаунт, а не выкидываем из системы совсем.
          const backup = localStorage.getItem(ADMIN_BACKUP_KEY);
          if (user.isImpersonated && backup) {
            const admin = JSON.parse(backup) as User;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(admin));
            localStorage.removeItem(ADMIN_BACKUP_KEY);
            setUser(admin);
          } else {
            localStorage.removeItem(STORAGE_KEY);
            setUser(null);
          }
          if (res.reason) window.alert(res.reason);
        }
      } catch {
        // Нет связи — оставляем сотрудника работать.
      }
    };

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(verify, 30 * 60 * 1000);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        verify();
        start();
      } else {
        stop();
      }
    };

    verify();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id, user?.role, user?.isDemo]);

  return (
    <AuthContext.Provider
      value={{ user, login, logout, switchRole, setActiveShift, impersonate, stopImpersonation }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};