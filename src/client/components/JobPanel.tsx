import { useEffect, useState } from "react";
import type { JobRecord } from "../../shared/types";
import { api } from "../api";
import { StatusBadge } from "./StatusBadge";

interface JobPanelProps {
  jobId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}

export function JobPanel({ jobId, onClose, onDone }: JobPanelProps) {
  const [job, setJob] = useState<JobRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      const data = await api<{ job: JobRecord }>(`/api/jobs/${jobId}`);
      if (cancelled) return;
      setJob(data.job);
      if (!["done", "failed"].includes(data.job.status)) {
        timer = window.setTimeout(poll, 1800);
      } else {
        await onDone();
      }
    }

    poll().catch(() => undefined);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobId, onDone]);

  return (
    <div className="job-drawer">
      <div className="job-head">
        <div>
          <p className="eyebrow">Job</p>
          <h3>{job?.currentStep || "Carregando"}</h3>
        </div>
        <button className="ghost" onClick={onClose}>Fechar</button>
      </div>
      <StatusBadge status={job?.status || "queued"} />
      <pre>{(job?.logs || []).join("\n")}</pre>
      {job?.id && <a href={`/api/jobs/${job.id}/logs`} target="_blank">Abrir logs completos</a>}
      {job?.error && <div className="alert">{job.error}</div>}
    </div>
  );
}
