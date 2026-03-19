import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const TOKEN_KEY = 'observability_token';

type AuthContextValue = {
  token: string | null;
  login: (t: string) => void;
  logout: () => void;
  isCloudMode: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  );
  const login = useCallback((t: string) => {
    setTokenState(t);
    localStorage.setItem(TOKEN_KEY, t);
  }, []);
  const logout = useCallback(() => {
    setTokenState(null);
    localStorage.removeItem(TOKEN_KEY);
  }, []);
  const isCloudMode = (import.meta.env.VITE_USE_CLOUD as string) === 'true';
  const value = useMemo(
    () => ({ token, login, logout, isCloudMode }),
    [token, login, logout, isCloudMode]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
