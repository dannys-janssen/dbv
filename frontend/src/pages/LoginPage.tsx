import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Username and password are required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const resp = await api.post<TokenResponse>("/auth/login", {
        username: username.trim(),
        password,
      });
      login(resp.data.access_token, resp.data.refresh_token);
      navigate("/");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#f0f4f8",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "12px",
          padding: "40px",
          width: "380px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
          boxSizing: "border-box",
        }}
      >
        {/* Logo row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              background: "#2563eb",
              borderRadius: "3px",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "#0f172a",
              fontFamily: FONT,
            }}
          >
            dbv
          </span>
        </div>

        <h1
          style={{
            fontSize: "24px",
            fontWeight: 700,
            color: "#0f172a",
            margin: "0 0 4px 0",
            fontFamily: FONT,
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            fontSize: "14px",
            color: "#64748b",
            margin: "0 0 28px 0",
            fontFamily: FONT,
          }}
        >
          Access your MongoDB databases
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "6px",
                fontFamily: FONT,
              }}
            >
              Username
            </label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                fontSize: "14px",
                boxSizing: "border-box",
                fontFamily: FONT,
                outline: "none",
                opacity: loading ? 0.6 : 1,
              }}
            />
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "#374151",
                marginBottom: "6px",
                fontFamily: FONT,
              }}
            >
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                fontSize: "14px",
                boxSizing: "border-box",
                fontFamily: FONT,
                outline: "none",
                opacity: loading ? 0.6 : 1,
              }}
            />
          </div>

          {error && (
            <p
              style={{
                fontSize: "13px",
                color: "#dc2626",
                margin: "0 0 12px 0",
                fontFamily: FONT,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: "#2563eb",
              color: "#ffffff",
              padding: "12px",
              borderRadius: "8px",
              fontSize: "15px",
              fontWeight: 600,
              border: "none",
              cursor: loading ? "not-allowed" : "pointer",
              marginTop: "8px",
              fontFamily: FONT,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            fontSize: "12px",
            color: "#94a3b8",
            margin: "20px 0 0 0",
            fontFamily: FONT,
          }}
        >
          Secured by Keycloak OAuth2
        </p>
      </div>
    </div>
  );
}

