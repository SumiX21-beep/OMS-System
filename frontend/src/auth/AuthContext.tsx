import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import {
  clearCredentials,
  getCredentials,
  setCredentials,
  type Credentials,
} from '@/lib/auth-store';
import type { Role } from '@/lib/types';

interface MeResponse {
  tenant: { id: string; slug: string; name: string } | null;
  role: Role;
}

interface LoginResponse {
  accessToken: string;
  role: Role;
  user: { id: string; email: string; name: string | null };
  tenant: { id: string; slug: string; name: string };
}

interface AuthValue {
  creds: Credentials | null;
  isAuthed: boolean;
  /** Verify an API key (or dev tenant) against /auth/me and store the real role. */
  signIn: (tenant: string, apiKey?: string) => Promise<void>;
  /** Email/password login → store the JWT session. */
  signInWithPassword: (
    tenant: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [creds, setCreds] = useState<Credentials | null>(getCredentials());

  const signIn = useCallback(async (tenant: string, apiKey?: string) => {
    // Stage creds so the API client sends them, then ask the server who we are.
    setCredentials({ tenant, apiKey, role: 'READ_ONLY' });
    try {
      const me = await api.get<MeResponse>('/auth/me');
      const next: Credentials = { tenant, apiKey, role: me.role };
      setCredentials(next);
      setCreds(next);
    } catch (err) {
      clearCredentials();
      setCreds(null);
      throw err;
    }
  }, []);

  const signInWithPassword = useCallback(
    async (tenant: string, email: string, password: string) => {
      // Public endpoint — no creds needed to log in.
      const res = await api.post<LoginResponse>('/auth/login', {
        tenant,
        email,
        password,
      });
      const next: Credentials = {
        tenant: res.tenant.slug,
        token: res.accessToken,
        email: res.user.email,
        role: res.role,
      };
      setCredentials(next);
      setCreds(next);
    },
    [],
  );

  const logout = useCallback(() => {
    clearCredentials();
    setCreds(null);
  }, []);

  // Refresh the role from the server on load (keeps it authoritative).
  useEffect(() => {
    if (!creds) return;
    api
      .get<MeResponse>('/auth/me')
      .then((me) => {
        if (me.role !== creds.role) {
          const next = { ...creds, role: me.role };
          setCredentials(next);
          setCreds(next);
        }
      })
      .catch(() => {
        clearCredentials();
        setCreds(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ creds, isAuthed: !!creds, signIn, signInWithPassword, logout }),
    [creds, signIn, signInWithPassword, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
