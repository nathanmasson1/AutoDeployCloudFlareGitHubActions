import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ClientRecord, ClientSummary, CloudflareAccount, PublicSettings, UserRecord, UserRole } from "../../shared/types";
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
  currentUser: UserRecord;
  clients: ClientSummary[];
  users: UserRecord[];
  selectedClientId: string;
  settings: PublicSettings | null;
  onClientSelect: (clientId: string) => void;
  onClientsChanged: (clientId: string) => Promise<void>;
  onSaved: () => Promise<void>;
}

export function SettingsPage({ currentUser, clients, users, selectedClientId, settings, onClientSelect, onClientsChanged, onSaved }: SettingsPageProps) {
  const selectedClient = clients.find((client) => client.id === selectedClientId) || clients[0] || null;
  const canManageUsers = currentUser.role === "admin";
  const [editingNewClient, setEditingNewClient] = useState(false);
  const [clientName, setClientName] = useState(selectedClient?.name || "");
  const [clientEmail, setClientEmail] = useState(selectedClient?.email || "");
  const [clientSaving, setClientSaving] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("client");
  const [userClientId, setUserClientId] = useState(selectedClientId);
  const [userActive, setUserActive] = useState(true);
  const [userSaving, setUserSaving] = useState(false);
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
    if (editingNewClient) return;
    setClientName(selectedClient?.name || "");
    setClientEmail(selectedClient?.email || "");
  }, [editingNewClient, selectedClient]);

  useEffect(() => {
    if (!editingUserId) setUserClientId(selectedClientId);
  }, [editingUserId, selectedClientId]);

  useEffect(() => {
    setToken("");
    setAccounts([]);
    setInspectStatus("idle");
    setNotice(null);
  }, [selectedClientId]);

  useEffect(() => {
    setAccountId(settings?.accountId || "");
    setAccountName(settings?.accountName || "");
    if (settings?.hasToken) setPreflightDone(true);
    setPaid(Boolean(settings?.cloudflarePaidPlan));
  }, [settings]);

  const hasUsableToken = token.trim() ? inspectStatus === "done" : Boolean(settings?.hasToken);
  const step1Done = preflightDone;
  const step2Done = step1Done && hasUsableToken && Boolean(accountId);
  const step3Done = step2Done && paid;
  const canSave = step3Done;
  const paidPlanUrl = accountId ? `https://dash.cloudflare.com/${accountId}/r2/plans` : "";
  const activeClientName = selectedClient?.name || "Cliente padrao";

  function resetUserForm() {
    setEditingUserId("");
    setUserName("");
    setUserEmail("");
    setUserPassword("");
    setUserRole("client");
    setUserClientId(selectedClientId);
    setUserActive(true);
  }

  function editUser(user: UserRecord) {
    setEditingUserId(user.id);
    setUserName(user.name);
    setUserEmail(user.email);
    setUserPassword("");
    setUserRole(user.role);
    setUserClientId(user.clientId);
    setUserActive(user.active);
  }

  async function saveClient(event: FormEvent) {
    event.preventDefault();
    if (!canManageUsers) return;
    const name = clientName.trim();
    if (!name) {
      setNotice({ kind: "warn", text: "Informe o nome do cliente antes de salvar." });
      return;
    }

    setClientSaving(true);
    setNotice(null);
    try {
      const data = await api<{ client: ClientRecord }>("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          id: editingNewClient ? undefined : selectedClientId,
          name,
          email: clientEmail.trim(),
        }),
      });
      setEditingNewClient(false);
      setNotice({ kind: "success", text: `Cliente ativo: ${data.client.name}.` });
      await onClientsChanged(data.client.id);
    } catch (error) {
      setNotice({ kind: "alert", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setClientSaving(false);
    }
  }

  async function saveUser(event: FormEvent) {
    event.preventDefault();
    if (!canManageUsers) return;
    setUserSaving(true);
    setNotice(null);
    try {
      const data = await api<{ user: UserRecord }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          id: editingUserId || undefined,
          name: userName,
          email: userEmail,
          password: userPassword,
          role: userRole,
          clientId: userClientId,
          active: userActive,
        }),
      });
      setNotice({ kind: "success", text: `Usuario salvo: ${data.user.name}.` });
      resetUserForm();
      await onSaved();
    } catch (error) {
      setNotice({ kind: "alert", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setUserSaving(false);
    }
  }

  const inspectToken = useCallback(async (nextToken: string, preferredAccountId = "") => {
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
  }, []);

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
  }, [accountId, inspectToken, token, preflightDone]);

  function selectAccount(nextAccountId: string) {
    const selected = accounts.find((account) => account.id === nextAccountId);
    setAccountId(nextAccountId);
    setAccountName(selected?.name || "");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (editingNewClient) {
      setNotice({ kind: "warn", text: "Salve o novo cliente antes de gravar as credenciais Cloudflare." });
      return;
    }
    if (!canSave) {
      setNotice({ kind: "warn", text: "Conclua os passos 1, 2 e 3 antes de salvar." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const data = await api<PublicSettings>(`/api/clients/${encodeURIComponent(selectedClientId)}/settings/cloudflare`, {
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
      setNotice({ kind: "success", text: `Credenciais de ${activeClientName} salvas para ${data.accountName || data.accountId}.` });
      await onSaved();
    } catch (error) {
      setNotice({ kind: "alert", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel stack">
      <Header eyebrow="Credenciais" title="Configurar Cloudflare" subtitle="Cada cliente pode usar sua propria conta Cloudflare e API Token." />

      {canManageUsers ? (
        <>
          <form className="client-config grid" onSubmit={saveClient}>
            <label>
              <span>Cliente ativo</span>
              <select
                value={selectedClientId}
                disabled={editingNewClient}
                onChange={(event) => {
                  setEditingNewClient(false);
                  onClientSelect(event.target.value);
                }}
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <small>Sites e credenciais abaixo pertencem a este cliente.</small>
            </label>

            <div className="actions client-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditingNewClient(true);
                  setClientName("");
                  setClientEmail("");
                }}
              >
                Novo cliente
              </button>
            </div>

            <label>
              <span>{editingNewClient ? "Nome do novo cliente" : "Nome do cliente"}</span>
              <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Cliente ou empresa" />
            </label>

            <label>
              <span>Email opcional</span>
              <input value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} placeholder="cliente@email.com" />
            </label>

            <div className="actions wide">
              <button type="submit" disabled={clientSaving}>
                {clientSaving ? "Salvando..." : editingNewClient ? "Criar cliente" : "Salvar cliente"}
              </button>
            </div>
          </form>

          <form className="client-config grid" onSubmit={saveUser}>
            <div className="wide">
              <h3>Usuarios</h3>
              <p className="hint compact">Admin gerencia tudo. Usuario cliente entra com email/senha e ve apenas o cliente vinculado.</p>
            </div>

            <label>
              <span>Nome</span>
              <input value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Nome do usuario" />
            </label>

            <label>
              <span>Email</span>
              <input type="email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} placeholder="usuario@email.com" />
            </label>

            <label>
              <span>Senha</span>
              <input
                type="password"
                value={userPassword}
                onChange={(event) => setUserPassword(event.target.value)}
                placeholder={editingUserId ? "Preencha somente para trocar" : "Senha inicial"}
              />
            </label>

            <label>
              <span>Tipo de acesso</span>
              <select value={userRole} onChange={(event) => setUserRole(event.target.value as UserRole)}>
                <option value="client">Cliente</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {userRole === "client" && (
              <label>
                <span>Cliente vinculado</span>
                <select value={userClientId} onChange={(event) => setUserClientId(event.target.value)}>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="check">
              <input type="checkbox" checked={userActive} onChange={(event) => setUserActive(event.target.checked)} />
              <span>Usuario ativo</span>
            </label>

            <div className="actions wide">
              <button type="submit" disabled={userSaving}>
                {userSaving ? "Salvando..." : editingUserId ? "Salvar usuario" : "Criar usuario"}
              </button>
              {editingUserId && <button type="button" className="secondary" onClick={resetUserForm}>Cancelar edicao</button>}
            </div>

            <div className="user-list wide">
              {users.map((user) => (
                <button type="button" className="user-row" key={user.id} onClick={() => editUser(user)}>
                  <span>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </span>
                  <span>{user.role === "admin" ? "Admin" : clients.find((client) => client.id === user.clientId)?.name || "Cliente"}</span>
                  <span>{user.active ? "Ativo" : "Inativo"}</span>
                </button>
              ))}
            </div>
          </form>
        </>
      ) : (
        <div className="client-config">
          <strong>Cliente ativo: {activeClientName}</strong>
          <p className="hint compact">Seu usuario esta vinculado a este cliente. Voce so ve sites, jobs e credenciais desta conta.</p>
        </div>
      )}

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
              <p>Clique no atalho, crie o token pre-preenchido e cole a Cloudflare API Token de {activeClientName}. Ao colar, o painel busca automaticamente Account ID e Account name.</p>
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
                  <span>Cliente</span>
                  <strong>{activeClientName}</strong>
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
