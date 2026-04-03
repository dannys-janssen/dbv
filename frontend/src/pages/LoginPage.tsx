import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError("Token is required");
      return;
    }
    login(token.trim());
    navigate("/");
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>dbv — MongoDB Viewer</h2>
        <p style={styles.subtitle}>
          Paste your Keycloak JWT access token to sign in.
        </p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <textarea
            style={styles.textarea}
            placeholder="Paste JWT token here..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={5}
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.button}>
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    background: "#f0f2f5",
  },
  card: {
    background: "#fff",
    padding: "2rem",
    borderRadius: "8px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.1)",
    width: "480px",
  },
  title: { marginBottom: "0.25rem" },
  subtitle: { color: "#666", marginBottom: "1.5rem", fontSize: "0.9rem" },
  form: { display: "flex", flexDirection: "column", gap: "1rem" },
  textarea: {
    fontFamily: "monospace",
    fontSize: "0.85rem",
    padding: "0.75rem",
    border: "1px solid #ddd",
    borderRadius: "4px",
    resize: "vertical",
  },
  error: { color: "red", margin: 0 },
  button: {
    padding: "0.75rem",
    background: "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontWeight: "bold",
  },
};
