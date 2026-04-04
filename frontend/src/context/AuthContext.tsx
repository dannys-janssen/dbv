import {
  createContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import api from "../api/client";

interface JwtPayload {
  realm_access?: { roles?: string[] };
  exp?: number;
}

/** Decode a base64url-encoded JWT segment (handles padding and url-safe chars). */
function base64urlDecode(s: string): string {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

function parsePayload(token: string): JwtPayload {
  try {
    return JSON.parse(base64urlDecode(token.split(".")[1])) as JwtPayload;
  } catch {
    return {};
  }
}

function parseRoles(token: string): string[] {
  return parsePayload(token).realm_access?.roles ?? [];
}

/**
 * Returns milliseconds until the token should be proactively refreshed
 * (60 s before expiry). Returns at least 10 s to prevent tight loops from
 * clock skew or tokens with very short lifetimes.
 */
function msUntilRefresh(token: string): number {
  const exp = parsePayload(token).exp;
  if (!exp) return 60_000; // Unknown expiry: retry in 1 minute
  const msLeft = exp * 1000 - Date.now();
  return Math.max(msLeft - 60_000, 10_000);
}

interface AuthContextValue {
  token: string | null;
  roles: string[];
  login: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  canWrite: boolean;
}

// AuthContext and AuthProvider are intentionally co-located; context export alongside component is the standard pattern.
// eslint-disable-next-line react-refresh/only-export-components -- context object is not a component
export const AuthContext = createContext<AuthContextValue>({
  token: null,
  roles: [],
  login: () => {},
  logout: () => {},
  isAuthenticated: false,
  canWrite: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem("access_token")
  );
  const [roles, setRoles] = useState<string[]>(() => {
    const t = localStorage.getItem("access_token");
    return t ? parseRoles(t) : [];
  });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logout = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setToken(null);
    setRoles([]);
  }, []);

  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const delay = msUntilRefresh(accessToken);
    refreshTimer.current = setTimeout(async () => {
      const rt = localStorage.getItem("refresh_token");
      if (!rt) { logout(); return; }
      try {
        const resp = await api.post<{ access_token: string; refresh_token: string }>(
          "/auth/refresh",
          { refresh_token: rt }
        );
        const { access_token, refresh_token } = resp.data;
        localStorage.setItem("access_token", access_token);
        localStorage.setItem("refresh_token", refresh_token);
        setToken(access_token);
        setRoles(parseRoles(access_token));
        scheduleRefresh(access_token);
      } catch {
        logout();
      }
    }, delay);
  }, [logout]); // logout is stable (useCallback []), so scheduleRefresh is too

  const login = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);
    setToken(accessToken);
    setRoles(parseRoles(accessToken));
    scheduleRefresh(accessToken);
  }, [scheduleRefresh]);

  // On mount, schedule refresh if we already have a stored token.
  useEffect(() => {
    if (token) scheduleRefresh(token);
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  // scheduleRefresh is stable (useCallback), token is only read once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canWrite = roles.includes("dbv-admin");

  const contextValue = useMemo(
    () => ({ token, roles, login, logout, isAuthenticated: !!token, canWrite }),
    [token, roles, login, logout, canWrite]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
