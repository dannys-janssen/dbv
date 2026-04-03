import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import api from "../api/client";

interface JwtPayload {
  realm_access?: { roles?: string[] };
  exp?: number;
}

function parsePayload(token: string): JwtPayload {
  try {
    return JSON.parse(atob(token.split(".")[1])) as JwtPayload;
  } catch {
    return {};
  }
}

function parseRoles(token: string): string[] {
  return parsePayload(token).realm_access?.roles ?? [];
}

/** Returns milliseconds until the token expires, minus a 60-second buffer. */
function msUntilRefresh(token: string): number {
  const exp = parsePayload(token).exp;
  if (!exp) return 0;
  const msLeft = exp * 1000 - Date.now();
  return Math.max(msLeft - 60_000, 0);
}

interface AuthContextValue {
  token: string | null;
  roles: string[];
  login: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  canWrite: boolean;
}

const AuthContext = createContext<AuthContextValue>({
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

  const logout = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setToken(null);
    setRoles([]);
  };

  const scheduleRefresh = (accessToken: string) => {
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
  };

  const login = (accessToken: string, refreshToken: string) => {
    localStorage.setItem("access_token", accessToken);
    localStorage.setItem("refresh_token", refreshToken);
    setToken(accessToken);
    setRoles(parseRoles(accessToken));
    scheduleRefresh(accessToken);
  };

  // On mount, schedule refresh if we already have a stored token.
  useEffect(() => {
    if (token) scheduleRefresh(token);
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canWrite = roles.includes("dbv-admin");

  return (
    <AuthContext.Provider
      value={{ token, roles, login, logout, isAuthenticated: !!token, canWrite }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
