import { useEffect } from "react";
import type { JobRecord, SiteRecord } from "../../shared/types";
import { api } from "../api";
import { Header } from "../components/Header";
import { StatusBadge } from "../components/StatusBadge";

interface SitesPageProps {
  sites: SiteRecord[];
  onJob: (jobId: string) => void;
  onChanged: (refreshSites?: boolean) => Promise<void>;
}

export function SitesPage({ sites, onJob, onChanged }: SitesPageProps) {
  useEffect(() => {
    if (!sites.some((site) => site.status === "building")) return;
    const refreshBuildingSites = () => onChanged(true).catch(() => undefined);
    refreshBuildingSites();
    const timer = window.setInterval(refreshBuildingSites, 60000);
    return () => window.clearInterval(timer);
  }, [sites, onChanged]);

  async function retry(site: SiteRecord) {
    const data = await api<{ job: JobRecord }>(`/api/sites/${site.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "retry-build" }),
    });
    onJob(data.job.id);
    await onChanged();
  }

  async function remove(site: SiteRecord) {
    const data = await api<{ job: JobRecord }>(`/api/sites/${site.id}`, { method: "DELETE" });
    onJob(data.job.id);
    await onChanged();
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Sites" title="Projetos publicados" subtitle="Acompanhe Workers, recursos e status dos deploys diretos." />
      <div className="table">
        {sites.map((site) => (
          <div className="site-row" key={site.id}>
            <div>
              <strong>{site.siteName}</strong>
              <span>{site.workerName}</span>
            </div>
            <StatusBadge status={site.status} />
            <div className="links">
              {site.workersDevUrl && <a href={site.workersDevUrl} target="_blank">Site</a>}
              {site.adminUrl && <a href={site.adminUrl} target="_blank">Admin</a>}
            </div>
            {site.status === "failed" && <button className="secondary" onClick={() => retry(site)}>Reexecutar deploy</button>}
            <button className="danger" onClick={() => remove(site)}>Excluir</button>
          </div>
        ))}
      </div>
    </section>
  );
}
