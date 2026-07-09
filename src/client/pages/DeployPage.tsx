import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { JobRecord, PublicSettings, TemplateRecord } from "../../shared/types";
import { api } from "../api";
import { Header } from "../components/Header";

interface DeployPageProps {
  templates: TemplateRecord[];
  settings: PublicSettings | null;
  onJob: (jobId: string) => void;
  onRefresh: () => Promise<void>;
}

export function DeployPage({ templates, settings, onJob, onRefresh }: DeployPageProps) {
  const [siteName, setSiteName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templates, templateId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("Provisionando recursos...");
    const data = await api<{ job: JobRecord }>("/api/sites/deploy", {
      method: "POST",
      body: JSON.stringify({ siteName, adminPassword, templateId, customDomain }),
    });
    setAdminPassword("");
    setMessage("Job criado.");
    onJob(data.job.id);
    await onRefresh();
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Novo deploy" title="Criar site" subtitle="Worker, D1, R2, KV, secrets, build remoto e dominio opcional." />
      {!settings?.hasToken && <div className="warn">Cadastre o token Cloudflare antes de criar sites.</div>}
      <form className="grid" onSubmit={submit}>
        <label>
          <span>Nome do site</span>
          <input value={siteName} onChange={(event) => setSiteName(event.target.value)} required placeholder="Clinica Aurora" />
        </label>
        <label>
          <span>Senha do admin</span>
          <input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required />
        </label>
        <label className="wide">
          <span>Dominio proprio opcional</span>
          <input value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="exemplo.com" />
        </label>
        <label className="wide">
          <span>Template</span>
          <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>
            <option value="">Selecione</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name} - {template.owner}/{template.repo}</option>
            ))}
          </select>
        </label>
        <button className="wide" disabled={!settings?.hasToken || !templates.length}>Criar e publicar</button>
      </form>
      {message && <div className="success">{message}</div>}
    </section>
  );
}
