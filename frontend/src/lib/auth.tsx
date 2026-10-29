import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, tokenStore } from './api';
import type { User } from './types';
import { useI18n } from './i18n';

interface AuthCtx {
  user: User | null;
  ready: boolean;
  setSession: (token: string, user: User) => void;
  logout: () => void;
}
const Ctx = createContext<AuthCtx>({ user: null, ready: false, setSession: () => {}, logout: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const { setLang } = useI18n();
  useEffect(() => {
    if (!tokenStore.get()) return setReady(true);
    api.get<{ user: User }>('/auth/me').then((r) => setUser(r.user)).catch(() => tokenStore.set(null)).finally(() => setReady(true));
  }, []);
  const setSession = (token: string, u: User) => {
    tokenStore.set(token);
    setUser(u);
    if (!localStorage.getItem('dhukuti.lang')) setLang(u.preferredLanguage);
  };
  const logout = () => {
    tokenStore.set(null);
    setUser(null);
  };
  return <Ctx.Provider value={{ user, ready, setSession, logout }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
