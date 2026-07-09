import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ClientSummary, MeResponse, PublicSettings, SiteRecord, TemplateRecord, UserRecord } from "../shared/types";
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

const SELECTED_CLIENT_STORAGE_KEY = "autodeploy:selectedClientId";

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<UserRecord | null>(null);

  useEffect(() => {
    api<MeResponse>("/api/me")
      .then((data) => {
        setAuthenticated(data.authenticated);
        setCurrentUser(data.user);
      })
      .catch(() => {
        setAuthenticated(false);
        setCurrentUser(null);
      });
  }, []);

  if (authenticated === null) return <FullScreenMessage title="Carregando" body="Preparando painel..." />;
  if (!authenticated || !currentUser) {
    return <Login onLogin={(user) => {
      setCurrentUser(user);
      setAuthenticated(true);
    }} />;
  }
  return <DashboardShell currentUser={currentUser} onLogout={() => {
    setCurrentUser(null);
    setAuthenticated(false);
  }} />;
}

function DashboardShell({ currentUser, onLogout }: { currentUser: UserRecord; onLogout: () => void }) {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(() => (
    currentUser.role === "admin" ? window.localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY) || "default" : currentUser.clientId
  ));
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [activeJobId, setActiveJobId] = useState("");
  const [notice, setNotice] = useState("");

  const loadAll = useCallback(async (refreshSites = false, clientIdOverride = "") => {
    const clientsData = await api<{ clients: ClientSummary[] }>("/api/clients");
    const usersData = currentUser.role === "admin" ? await api<{ users: UserRecord[] }>("/api/users") : { users: [] };
    const requestedClientId = clientIdOverride || selectedClientId || "default";
    const allowedClientId = currentUser.role === "admin" ? requestedClientId : currentUser.clientId;
    const effectiveClientId = clientsData.clients.some((client) => client.id === allowedClientId)
      ? allowedClientId
      : clientsData.clients[0]?.id || "default";
    if (effectiveClientId !== selectedClientId) {
      window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, effectiveClientId);
      setSelectedClientId(effectiveClientId);
    }

    const siteQuery = new URLSearchParams({ clientId: effectiveClientId });
    if (refreshSites) siteQuery.set("refresh", "1");

    const [settingsData, templatesData, sitesData] = await Promise.all([
      api<PublicSettings>(`/api/clients/${encodeURIComponent(effectiveClientId)}/settings/cloudflare`),
      api<{ templates: TemplateRecord[] }>("/api/templates"),
      api<{ sites: SiteRecord[] }>(`/api/sites?${siteQuery.toString()}`),
    ]);
    setClients(clientsData.clients);
    setUsers(usersData.users);
    setSettings(settingsData);
    setTemplates(templatesData.templates);
    setSites(sitesData.sites);
  }, [currentUser, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || clients[0] || null,
    [clients, selectedClientId],
  );
  const navItems = useMemo(
    () => currentUser.role === "admin" ? NAV_ITEMS : NAV_ITEMS.filter((item) => item.id !== "domains"),
    [currentUser.role],
  );

  const selectClient = useCallback((clientId: string) => {
    window.localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, clientId);
    setSelectedClientId(clientId);
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
    if (page === "settings") {
      return (
        <SettingsPage
          currentUser={currentUser}
          clients={clients}
          users={users}
          selectedClientId={selectedClientId}
          settings={settings}
          onClientSelect={selectClient}
          onClientsChanged={async (clientId) => {
            selectClient(clientId);
            await loadAll(false, clientId);
          }}
          onSaved={loadAll}
        />
      );
    }
    if (page === "templates") return <TemplatesPage canManage={currentUser.role === "admin"} templates={templates} onChanged={loadAll} />;
    if (page === "deploy") return <DeployPage clientId={selectedClientId} clientName={selectedClient?.name || ""} templates={templates} settings={settings} onJob={setActiveJobId} onRefresh={loadAll} />;
    if (page === "sites") return <SitesPage clientName={selectedClient?.name || ""} sites={sites} onJob={setActiveJobId} onChanged={loadAll} />;
    if (page === "domains") return <DomainsPage />;
    return <HomePage clientName={selectedClient?.name || ""} settings={settings} templates={templates} sites={sites} onNavigate={navigate} />;
  }, [page, currentUser, clients, users, selectedClientId, selectedClient, settings, templates, sites, loadAll, selectClient, navigate]);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Auto Deploy</p>
          <h1>Cloudflare</h1>
          {selectedClient && <p className="sidebar-client">{selectedClient.name}</p>}
        </div>
        <nav>
          {navItems.map((item) => (
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
