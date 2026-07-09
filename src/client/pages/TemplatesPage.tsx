import { useState } from "react";
import type { FormEvent } from "react";
import type { TemplateRecord } from "../../shared/types";
import { api } from "../api";
import { Header } from "../components/Header";

interface TemplatesPageProps {
  templates: TemplateRecord[];
  onChanged: () => Promise<void>;
}

export function TemplatesPage({ templates, onChanged }: TemplatesPageProps) {
  const [name, setName] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("Validando template...");
    try {
      await api("/api/templates", { method: "POST", body: JSON.stringify({ name, githubUrl }) });
      setName("");
      setGithubUrl("");
      setMessage("Template salvo.");
      await onChanged();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessage("");
      setError(
        detail.includes("scripts/")
          ? `${detail} Envie os scripts de autodeploy para o GitHub antes de cadastrar este template.`
          : detail,
      );
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    await api(`/api/templates/${id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Templates" title="GitHub publicos" subtitle="Cada template precisa incluir os scripts de autodeploy." />
      <div className="warn">
        Para usar <strong>nathanmasson1/template-cloudflare4</strong>, confirme que o commit com <code>scripts/autodeploy-prepare.mjs</code>, <code>scripts/autodeploy-deploy.mjs</code> e <code>scripts/prepare-cloudflare-assets.mjs</code> ja foi enviado ao GitHub.
      </div>
      <form className="grid" onSubmit={submit}>
        <label>
          <span>Nome</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Template noticias" />
        </label>
        <label className="wide">
          <span>URL GitHub</span>
          <input value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} required placeholder="https://github.com/usuario/template/tree/main/subpasta" />
        </label>
        <button className="wide" disabled={loading}>{loading ? "Validando..." : "Cadastrar template"}</button>
      </form>
      {message && <div className="success">{message}</div>}
      {error && <div className="alert">{error}</div>}
      <div className="card-grid">
        {templates.map((template) => (
          <article className="item-card" key={template.id}>
            <strong>{template.name}</strong>
            <span>{template.owner}/{template.repo}@{template.branch}</span>
            <small>{template.subdir || "/"}</small>
            <button className="danger" onClick={() => remove(template.id)}>Remover</button>
          </article>
        ))}
      </div>
    </section>
  );
}
