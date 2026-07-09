import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { CloudflareAccount, PublicSettings } from "../../shared/types";
import { api } from "../api";
import { Header } from "../components/Header";

const CLOUDFLARE_TOKEN_PERMISSION_GROUPS = [
  { key: "d1", type: "edit" },
  { key: "workers_r2", type: "edit" },
  { key: "workers_kv_storage", type: "edit" },
  { key: "workers_scripts", type: "edit" },
  { key: "account_settings", type: "edit" },
  { key: "zone", type: "read" },
  { key: "zone", type: "edit" },
  { key: "dns", type: "edit" },
  { key: "workers_routes", type: "edit" },
];
const CLOUDFLARE_PREFILLED_TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
  JSON.stringify(CLOUDFLARE_TOKEN_PERMISSION_GROUPS),
)}&accountId=*&zoneId=all&name=auto-deploy-cloudflare-setup`;
const CLOUDFLARE_LOGIN_URL = "https://dash.cloudflare.com/login";

type InspectStatus = "idle" | "loading" | "done" | "error";
type Notice = { kind: "success" | "warn" | "alert"; text: string };

interface TokenInspectionResponse {
  accounts: CloudflareAccount[];
  selectedAccountId: string;
  selectedAccountName: string;
}

interface SettingsPageProps {
  settings: PublicSettings | null;
  onSaved: () => Promise<void>;
}

export function SettingsPage({ settings, onSaved }: SettingsPageProps) {
  const [token, setToken] = useState("");
  const [accountId, setAccountId] = useState(settings?.accountId || "");
  const [accountName, setAccountName] = useState(settings?.accountName || "");
  const [preflightDone, setPreflightDone] = useState(Boolean(settings?.hasToken));
  const [paid, setPaid] = useState(Boolean(settings?.cloudflarePaidPlan));
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([]);
  const [inspectStatus, setInspectStatus] = useState<InspectStatus>("idle");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAccountId(settings?.accountId || "");
    setAccountName(settings?.accountName || "");
    if (settings?.hasToken) setPreflightDone(true);
    setPaid(Boolean(settings?.cloudflarePaidPlan));
  }, [settings]);

  useEffect(() => {
    if (!preflightDone || !token.trim()) {
      if (!token.trim()) setInspectStatus("idle");
      return;
    }

    const tokenToInspect = token.trim();
    const preferredAccountId = accountId;
    const timeoutId = window.setTimeout(() => {
      void inspectToken(tokenToInspect, preferredAccountId);
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [token, preflightDone]);

  const hasUsableToken = token.trim() ? inspectStatus === "done" : Boolean(settings?.hasToken);
  const step1Done = preflightDone;
  const step2Done = step1Done && hasUsableToken && Boolean(accountId);
  const step3Done = step2Done && paid;
  const canSave = step3Done;
  const paidPlanUrl = accountId ? `https://dash.cloudflare.com/${accountId}/r2/plans` : "";

  async function inspectToken(nextToken: string, preferredAccountId = "") {
    if (!nextToken.trim()) return;
    setInspectStatus("loading");
    setNotice(null);

    try {
      const data = await api<TokenInspectionResponse>("/api/cloudflare/token-inspect", {
        method: "POST",
        body: JSON.stringify({
          cloudflareToken: nextToken.trim(),
          accountId: preferredAccountId,
        }),
      });

      setAccounts(data.accounts);
      setAccountId(data.selectedAccountId);
      setAccountName(data.selectedAccountName);
      setInspectStatus("done");

      if (!data.accounts.length) {
        setNotice({ kind: "warn", text: "Token validado, mas nenhuma conta Cloudflare foi retornada para ele." });
      } else {
        setNotice({ kind: "success", text: "Account ID e Account name carregados automaticamente." });
      }
    } catch (error) {
      setInspectStatus("error");
      setNotice({ kind: "alert", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function selectAccount(nextAccountId: string) {
    const selected = accounts.find((account) => account.id === nextAccountId);
    setAccountId(nextAccountId);
    setAccountName(selected?.name || "");
    if (token.trim()) void inspectToken(token, nextAccountId);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) {
      setNotice({ kind: "warn", text: "Conclua os passos 1, 2 e 3 antes de salvar." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const data = await api<PublicSettings>("/api/settings/cloudflare", {
        method: "POST",
        body: JSON.stringify({
          cloudflareToken: token,
          accountId,
          accountName,
          buildTokenUuid: "",
          buildTokenName: "",
          githubAppAcknowledged: true,
          cloudflarePaidPlan: paid,
        }),
      });
      setToken("");
      setNotice({ kind: "success", text: `Credenciais salvas para ${data.accountName || data.accountId}.` });
      await onSaved();
    } catch (error) {
      setNotice({ kind: "alert", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Credenciais" title="Configurar Cloudflare" subtitle="Deploy direto por GitHub Actions: o cliente precisa apenas da conta Cloudflare e do API Token." />

      <form className="stack" onSubmit={save}>
        <article className={stepClass(true, step1Done)}>
          <span className="step-number">1</span>
          <div>
            <h3>Entrar ou criar conta Cloudflare</h3>
            <p>Entre na conta Cloudflare onde os Workers, D1, R2, KV e dominios serao criados.</p>
            <div className="button-row">
              <ExternalButton href={CLOUDFLARE_LOGIN_URL}>Entrar na Cloudflare</ExternalButton>
            </div>
            <label className="check">
              <input type="checkbox" checked={preflightDone} onChange={(event) => setPreflightDone(event.target.checked)} />
              <span>Ja entrei ou criei minha conta Cloudflare.</span>
            </label>
          </div>
        </article>

        <article className={stepClass(step1Done, step2Done)}>
          <span className="step-number">2</span>
          <div className="stack">
            <div>
              <h3>Crie um API Token na Cloudflare</h3>
              <p>Clique no atalho, crie o token pre-preenchido e cole a Cloudflare API Token aqui. Ao colar, o painel busca automaticamente Account ID e Account name.</p>
            </div>

            {!step1Done && <p className="hint compact">Complete o passo 1 para liberar esta etapa.</p>}

            {step1Done && (
              <>
                <div className="button-row">
                  <TokenShortcutButton />
                </div>

                <label className="wide">
                  <span>Cloudflare API Token</span>
                  <input
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={settings?.tokenMask || "Cole aqui o token copiado da Cloudflare"}
                  />
                  <small>{settings?.hasToken && !token ? `Token salvo: ${settings.tokenMask}` : "Depois que voce colar, a busca automatica comeca em alguns segundos."}</small>
                </label>

                {inspectStatus === "loading" && <div className="warn">Buscando Account ID e Account name...</div>}

                {(accountId || accounts.length > 0) && (
                  <div className="grid">
                    <label>
                      <span>Account ID</span>
                      {accounts.length > 1 ? (
                        <select value={accountId} onChange={(event) => selectAccount(event.target.value)}>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} ({account.id})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input value={accountId} readOnly placeholder="Account ID carregado automaticamente" />
                      )}
                      <small>{accountName || "Conta Cloudflare selecionada automaticamente."}</small>
                    </label>

                    <label>
                      <span>Account name</span>
                      <input value={accountName} readOnly placeholder="Nome da conta" />
                      <small>Usado para voce reconhecer a conta no painel.</small>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        </article>

        <article className={stepClass(step2Done, step3Done)}>
          <span className="step-number">3</span>
          <div>
            <h3>Ativar Plano pago Cloudflare</h3>
            <p>Abra a pagina de planos R2 da conta selecionada e confirme que o plano pago esta ativo quando o template exigir.</p>
            {!step2Done && <p className="hint compact">Complete o passo 2 para gerar o link com seu Account ID.</p>}
            {step2Done && paidPlanUrl && (
              <div className="button-row">
                <ExternalButton href={paidPlanUrl}>Ativar Plano pago Cloudflare</ExternalButton>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={paid} disabled={!step2Done} onChange={(event) => setPaid(event.target.checked)} />
              <span>Minha conta Cloudflare esta com plano pago ativo quando necessario.</span>
            </label>
          </div>
        </article>

        <article className={stepClass(step3Done, canSave)}>
          <span className="step-number">4</span>
          <div className="stack">
            <div>
              <h3>Revisar e salvar</h3>
              <p>Confira tudo antes de gravar as credenciais no painel.</p>
            </div>

            {!step3Done && <p className="hint compact">Complete o passo 3 para liberar o salvamento.</p>}

            {step3Done && (
              <>
                <div className="review-list">
                  <span>Cloudflare</span>
                  <strong>{preflightDone ? "Conta confirmada" : "Pendente"}</strong>
                  <span>Cloudflare API Token</span>
                  <strong>{token ? "Novo token colado" : settings?.tokenMask || "Pendente"}</strong>
                  <span>Account ID</span>
                  <strong>{accountId || "Pendente"}</strong>
                  <span>Account name</span>
                  <strong>{accountName || "Pendente"}</strong>
                  <span>Plano pago Cloudflare</span>
                  <strong>{paid ? "Confirmado" : "Pendente"}</strong>
                </div>

                <div className="actions">
                  <button type="submit" disabled={!canSave || saving}>
                    {saving ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </article>
      </form>

      {notice && <div className={notice.kind}>{notice.text}</div>}
    </section>
  );
}

function stepClass(enabled: boolean, done: boolean) {
  return `guide-card setup-step${enabled ? "" : " locked"}${done ? " done" : ""}`;
}

function ExternalButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="button-link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function TokenShortcutButton() {
  function openTokenForm() {
    window.open(CLOUDFLARE_PREFILLED_TOKEN_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <button type="button" className="shortcut-button" onClick={openTokenForm}>
      Criar token pre-preenchido
    </button>
  );
}
