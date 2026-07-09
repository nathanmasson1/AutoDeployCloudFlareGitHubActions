import type { PublicSettings, SiteRecord, TemplateRecord } from "../../shared/types";
import type { Page } from "../app-types";

interface HomePageProps {
  clientName: string;
  settings: PublicSettings | null;
  templates: TemplateRecord[];
  sites: SiteRecord[];
  onNavigate: (page: Page) => void;
}

export function HomePage({ clientName, settings, templates, sites, onNavigate }: HomePageProps) {
  return (
    <div className="stack">
      <section className="hero-band">
        <div>
          <p className="eyebrow">GitHub Actions runner</p>
          <h2>Deploy de templates GitHub para Cloudflare</h2>
          <p>Crie Workers com D1, R2, KV, secrets, build remoto por GitHub Actions e dominio customizado sem sair deste painel.</p>
        </div>
        <button onClick={() => onNavigate("deploy")}>Criar site</button>
      </section>
      <div className="metric-grid">
        <Metric label="Cliente" value={clientName || "Cliente padrao"} />
        <Metric label="Token" value={settings?.hasToken ? settings.tokenMask : "Nao cadastrado"} />
        <Metric label="Templates" value={String(templates.length)} />
        <Metric label="Sites" value={String(sites.length)} />
      </div>
      {!settings?.hasToken && (
        <div className="warn">
          Cadastre a <strong>Cloudflare API Token</strong> em Credenciais antes do primeiro deploy direto.
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
