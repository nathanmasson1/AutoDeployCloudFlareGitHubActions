import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Cloudflare Workers + D1 + R2</p>
        <h1>Auto Deploy Cloudflare</h1>
        <p>Entre com a senha configurada em `APP_ADMIN_SECRET`.</p>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha do painel" required />
        {error && <div className="alert">{error}</div>}
        <button disabled={loading}>{loading ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}
