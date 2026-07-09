import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicSettings, SiteRecord, TemplateRecord } from "../shared/types";
import { api } from "./api";
import { PAGE_PATHS, pageFromPath, type Page } from "./app-types";
import { FullScreenMessage } from "./components/FullScreenMessage";
import { JobPanel } from "./components/JobPanel";
import { Login } from "./components/Login";
import { DeployPage } from "./pages/DeployPage";
import { DomainsPage } from "./pages/DomainsPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SitesPage } from "./pages/SitesPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import "./styles.css";

const NAV_ITEMS: Array<{ id: Page; label: string }> = [
  { id: "dashboard", label: "Painel" },
  { id: "settings", label: "Credenciais" },
  { id: "templates", label: "Templates" },
  { id: "deploy", label: "Criar" },
  { id: "sites", label: "Sites" },
  { id: "domains", label: "Dominios" },
];

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ authenticated: boolean }>("/api/me")
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) return <FullScreenMessage title="Carregando" body="Preparando painel..." />;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <DashboardShell onLogout={() => setAuthenticated(false)} />;
}

function DashboardShell({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [notice, setNotice] = useState("");

  const loadAll = useCallback(async (refreshSites = false) => {
    const [settingsData, templatesData, sitesData] = await Promise.all([
      api<PublicSettings>("/api/settings/cloudflare"),
      api<{ templates: TemplateRecord[] }>("/api/templates"),
      api<{ sites: SiteRecord[] }>(refreshSites ? "/api/sites?refresh=1" : "/api/sites"),
    ]);
    setSettings(settingsData);
    setTemplates(templatesData.templates);
    setSites(sitesData.sites);
  }, []);

  const navigate = useCallback((nextPage: Page) => {
    const nextPath = PAGE_PATHS[nextPage];
    if (window.location.pathname !== nextPath) {
      window.history.pushState(null, "", nextPath);
    }
    setPage(nextPage);
  }, []);

  useEffect(() => {
    loadAll().catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [loadAll]);

  useEffect(() => {
    function handlePopState() {
      setPage(pageFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
    onLogout();
  }

  const content = useMemo(() => {
    if (page === "settings") return <SettingsPage settings={settings} onSaved={loadAll} />;
    if (page === "templates") return <TemplatesPage templates={templates} onChanged={loadAll} />;
    if (page === "deploy") return <DeployPage templates={templates} settings={settings} onJob={setActiveJobId} onRefresh={loadAll} />;
    if (page === "sites") return <SitesPage sites={sites} onJob={setActiveJobId} onChanged={loadAll} />;
    if (page === "domains") return <DomainsPage />;
    return <HomePage settings={settings} templates={templates} sites={sites} onNavigate={navigate} />;
  }, [page, settings, templates, sites, loadAll, navigate]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Auto Deploy</p>
          <h1>Cloudflare</h1>
        </div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              className={page === item.id ? "active" : ""}
              href={PAGE_PATHS[item.id]}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.id);
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button className="ghost" onClick={logout}>Sair</button>
      </aside>
      <section className="content">
        {notice && <div className="alert">{notice}</div>}
        {content}
        {activeJobId && <JobPanel jobId={activeJobId} onClose={() => setActiveJobId("")} onDone={loadAll} />}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
