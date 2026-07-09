import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import { Header } from "../components/Header";

export function DomainsPage() {
  const [customDomain, setCustomDomain] = useState("");
  const [workerName, setWorkerName] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const data = await api<{ message: string }>("/api/domains/cleanup", {
      method: "POST",
      body: JSON.stringify({ customDomain, workerName }),
    });
    setMessage(data.message);
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Dominios" title="Limpeza e diagnostico" subtitle="V1 mantem a limpeza principal no fluxo de exclusao do site." />
      <form className="grid" onSubmit={submit}>
        <label>
          <span>Dominio</span>
          <input value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="exemplo.com" />
        </label>
        <label>
          <span>Worker</span>
          <input value={workerName} onChange={(event) => setWorkerName(event.target.value)} placeholder="worker-name" />
        </label>
        <button className="wide">Verificar limpeza</button>
      </form>
      {message && <div className="warn">{message}</div>}
    </section>
  );
}
