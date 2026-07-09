import { useState } from "react";
import type { FormEvent } from "react";
import type { UserRecord } from "../../shared/types";
import { api } from "../api";

interface LoginProps {
  onLogin: (user: UserRecord) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api<{ user: UserRecord }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      onLogin(data.user);
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
        <p>Entre com email e senha. No primeiro acesso, use a senha `APP_ADMIN_SECRET` para criar o admin inicial.</p>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha do painel" required />
        {error && <div className="alert">{error}</div>}
        <button disabled={loading}>{loading ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}
