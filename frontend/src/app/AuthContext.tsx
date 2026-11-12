import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, OfflineError, refreshAccess, setAccessToken, setOnAuthLost } from '@/lib/api';
import { db, getMeta, setMeta, wipeLocalData } from '@/offline/db';
import type { Me } from './types';

const OFFLINE_SESSION_DAYS = 7;

interface AuthState {
  user: Me | null;
  loading: boolean;
  offlineSession: boolean; // signed in from the device cache while the server is unreachable
  login: (username: string, password: string) => Promise<Me>;
  logout: (force?: boolean) => Promise<{ pending: number } | void>;
  reload: () => Promise<void>;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  /** Most senior role level (1 = System Administrator). */
  level: number;
  isGlobal: boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

async function cacheSession(user: Me) {
  const previous = await getMeta<{ user: Me }>('session');
  if (previous && previous.user.id !== user.id) {
    // Never let one person's offline data leak to another account on a shared device.
    await wipeLocalData();
  }
  await setMeta('session', { user, cachedAt: new Date().toISOString() });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);

  const restoreOffline = useCallback(async () => {
    const cached = await getMeta<{ user: Me; cachedAt: string }>('session');
    if (cached && Date.now() - new Date(cached.cachedAt).getTime() < OFFLINE_SESSION_DAYS * 86400000) {
      setUser(cached.user);
      setOfflineSession(true);
      return true;
    }
    return false;
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const data = await refreshAccess();
      if (data) {
        const me = data.user as Me;
        setUser(me);
        setOfflineSession(false);
        await cacheSession(me);
      } else {
        setUser(null);
      }
    } catch (e) {
      if (e instanceof OfflineError) {
        if (!(await restoreOffline())) setUser(null);
      } else setUser(null);
    } finally {
      setLoading(false);
    }
  }, [restoreOffline]);

  useEffect(() => {
    setOnAuthLost(() => {
      setAccessToken(null);
      setUser(null);
    });
    bootstrap();
  }, [bootstrap]);

  // When connectivity returns during an offline session, obtain a real token.
  useEffect(() => {
    if (!offlineSession) return;
    const onOnline = () => bootstrap();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [offlineSession, bootstrap]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api<{ access: string; user: Me }>('/auth/login/', { method: 'POST', body: { username, password } });
    setAccessToken(data.access);
    await cacheSession(data.user);
    setUser(data.user);
    setOfflineSession(false);
    return data.user;
  }, []);

  const logout = useCallback(async (force = false) => {
    const pending = await db.outbox.where('status').anyOf('pending', 'failed', 'conflict', 'syncing').count();
    if (pending > 0 && !force) return { pending };
    try {
      await api('/auth/logout/', { method: 'POST' });
    } catch (e) {
      if (!(e instanceof OfflineError) && !(e instanceof ApiError)) throw e;
    }
    setAccessToken(null);
    await wipeLocalData();
    setUser(null);
    setOfflineSession(false);
  }, []);

  const reload = useCallback(async () => {
    const me = await api<Me>('/auth/me/');
    setUser(me);
    await cacheSession(me);
  }, []);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(user?.permissions || []);
    const level = Math.min(99, ...(user?.assignments || []).map((a) => a.role_level));
    return {
      user, loading, offlineSession, login, logout, reload,
      can: (p) => perms.has(p),
      canAny: (...ps) => ps.some((p) => perms.has(p)),
      level,
      isGlobal: (user?.assignments || []).some((a) => a.org_unit_type === 'headquarters' && a.role_level <= 2),
    };
  }, [user, loading, offlineSession, login, logout, reload]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
