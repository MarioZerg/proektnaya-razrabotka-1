import { createContext, useContext, useState, ReactNode } from 'react';
import type { Role } from '@/lib/roles';

export interface User {
  id: number;
  name: string;
  role: Role;
  /** Все утверждённые администратором должности пользователя — для переключателя ролей. */
  availableRoles: Role[];
  workshopId: number | null;
  workshopName: string | null;
  shiftNumber: number | null;
  isDemo?: boolean;
}

interface AuthContextValue {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  switchRole: (role: Role) => void;
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

  return (
    <AuthContext.Provider value={{ user, login, logout, switchRole }}>{children}</AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
