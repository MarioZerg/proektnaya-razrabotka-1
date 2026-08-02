import { createContext, useContext, useState, ReactNode } from 'react';
import type { Role } from '@/lib/roles';

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
}

interface AuthContextValue {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  switchRole: (role: Role) => void;
  setActiveShift: (workshopId: number | null, shiftNumber: number | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'megatul_user';

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
    setUser(null);
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

  return (
    <AuthContext.Provider value={{ user, login, logout, switchRole, setActiveShift }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
