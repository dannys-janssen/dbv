import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface JwtPayload {
  realm_access?: { roles?: string[] };
}

function parseRoles(token: string): string[] {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as JwtPayload;
    return payload.realm_access?.roles ?? [];
  } catch {
    return [];
  }
}

interface AuthContextValue {
  token: string | null;
  roles: string[];
  login: (token: string) => void;
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

  const login = (t: string) => {
    localStorage.setItem("access_token", t);
    setToken(t);
    setRoles(parseRoles(t));
  };

  const logout = () => {
    localStorage.removeItem("access_token");
    setToken(null);
    setRoles([]);
  };

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
