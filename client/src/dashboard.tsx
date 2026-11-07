import { useCallback, useEffect, useState, type FormEvent } from "react";
import { LIMITS, type DocumentInfo } from "../../shared/contracts.js";
import { api, ApiError, auth, type DashboardData } from "./api.js";

const errorText = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

function SignIn() {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email"));
    const password = String(fields.get("password"));
    setBusy(true);
    setMessage("");
    try {
      const result = creating
        ? await auth.signUp.email({ name: String(fields.get("name")), email, password })
        : await auth.signIn.email({ email, password });
      if (result.error) setMessage(result.error.message ?? "Sign-in failed.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return <main className="welcome">
    <div className="hero">
      <span className="eyebrow">KNOWLEDGE & DECISIONS</span>
      <h1>Put your documents to work.</h1>
      <p>Turn your organization’s PDFs into a private knowledge base and a shareable assistant with page-level citations.</p>
    </div>
    <section className="panel account">
      <h2>{creating ? "Create an account" : "Sign in"}</h2>
      <form onSubmit={submit}>
        {creating && <label>Name<input name="name" required autoComplete="name" /></label>}
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password<input name="password" type="password" required minLength={8}
          autoComplete={creating ? "new-password" : "current-password"} /></label>
        {message && <p className="error" role="alert">{message}</p>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : creating ? "Create account" : "Sign in"}</button>
      </form>
      <button className="text-button" onClick={() => { setCreating(!creating); setMessage(""); }}>
        {creating ? "Already have an account? Sign in" : "New to Cogniva? Create an account"}
      </button>
    </section>
  </main>;
}

function DocumentRow({ document, busy, action, upload }: {
  document: DocumentInfo; busy: boolean;
  action(path: string, method: string): void;
  upload(file: File, replaces: string): void;
}) {
  const path = `/api/admin/documents/${document.id}`;
  const size = document.size < 1_000_000 ? `${Math.ceil(document.size / 1000)} KB` : `${(document.size / 1_000_000).toFixed(1)} MB`;
  return <li className="document">
    <div className="document-info">
      <a className="document-name" href={path + "/file"}>{document.name}</a>
      <span className="muted">{size}{document.pages ? ` · ${document.pages} page${document.pages === 1 ? "" : "s"}` : ""}{document.replaces ? " · Replacement" : ""}</span>
      {document.error && <span className="error">{document.error}</span>}
    </div>
    <div className="document-actions">
      <span className={`tag ${document.status}`}>{document.status}</span>
      {document.status === "failed" && <button disabled={busy} onClick={() => action(path + "/retry", "POST")}>Retry</button>}
      {document.status === "ready" && <label className="button file-button">Replace
        <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0];
          if (file) upload(file, document.id);
          event.currentTarget.value = "";
        }} />
      </label>}
      <button disabled={busy} onClick={() => {
        if (window.confirm(`Delete ${document.name}?`)) action(path, "DELETE");
      }}>Delete</button>
    </div>
  </li>;
}

export function Dashboard() {
  const session = auth.useSession();
  const userId = session.data?.user.id;
  const [data, setData] = useState<DashboardData>();
  const [needsOrganization, setNeedsOrganization] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      setData(await api<DashboardData>("/api/admin/dashboard"));
      setNeedsOrganization(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "organization_required") setNeedsOrganization(true);
      else setError(errorText(failure));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (userId) void refresh();
    else {
      setData(undefined);
      setLoaded(false);
      setNeedsOrganization(false);
    }
  }, [userId, refresh]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("organization")).trim();
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
    await run(async () => {
      const result = await auth.organization.create({ name, slug: `${slug || "org"}-${crypto.randomUUID().slice(0, 8)}` });
      if (result.error) throw new Error(result.error.message ?? "Could not create your organization.");
    });
  }

  function upload(file: File, replaces?: string) {
    if (file.size > LIMITS.bytes) {
      setError("Each PDF must be 10 MB or smaller.");
      return;
    }
    const form = new FormData();
    form.set("file", file);
    void run(() => api(replaces ? `/api/admin/documents/${replaces}` : "/api/admin/documents", {
      method: replaces ? "PUT" : "POST", body: form,
    }));
  }

  function action(path: string, method: string) {
    void run(() => api(path, { method }));
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError("Could not copy automatically. Select and copy the text.");
    }
  }

  if (session.isPending) return <main className="page"><p role="status">Loading Cogniva…</p></main>;
  if (!userId) return <SignIn />;
  const url = data?.token ? `${window.location.origin}/assistant#token=${data.token}` : "";
  const embedTitle = `${data?.organization.name ?? "Cogniva"} assistant`
    .replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const embed = url ? `<iframe src="${url}" title="${embedTitle}" width="480" height="640" referrerpolicy="no-referrer"></iframe>` : "";

  return <>
    <header className="bar">
      <span className="brand">Cogniva</span>
      <span className="bar-label">Organization workspace</span>
      <button onClick={async () => { await auth.signOut(); setError(""); setNotice(""); }}>Sign out</button>
    </header>
    <main className="page">
      {error && <p className="error banner" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!loaded && <p role="status">Opening your workspace…</p>}
      {loaded && needsOrganization && <section className="panel account">
        <h1>Create your organization</h1>
        <form onSubmit={createOrganization}>
          <label>Organization name<input name="organization" required maxLength={80} /></label>
          <button className="primary" disabled={busy}>Create workspace</button>
        </form>
      </section>}
      {data && <>
        <div className="workspace-heading"><span className="eyebrow">WORKSPACE</span><h1>{data.organization.name}</h1></div>
        <div className="metrics">
          <div><span>Questions</span><strong>{data.usage.asked}</strong></div>
          <div><span>Answered</span><strong>{data.usage.answered}</strong></div>
          <div><span>Unable to answer</span><strong>{data.usage.no_answer}</strong></div>
          <div><span>Needs clarification</span><strong>{data.usage.needs_clarification}</strong></div>
          <div><span>Needs review</span><strong>{data.usage.unresolved}</strong></div>
          <div><span>Service errors</span><strong>{data.usage.failed}</strong></div>
        </div>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="section-heading">
              <h2>Knowledge base</h2>
              <label className="button primary file-button">Upload PDF
                <input type="file" accept=".pdf,application/pdf" disabled={busy} onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  if (file) upload(file);
                  event.currentTarget.value = "";
                }} />
              </label>
            </div>
            <p className="muted">{data.documents.filter(doc => !doc.replaces).length}/{LIMITS.documents} PDFs · Up to {LIMITS.pages} pages and 10 MB each</p>
            {busy && <p className="muted" role="status">Working…</p>}
            {data.documents.length ? <ul className="documents">
              {data.documents.map(document => <DocumentRow key={document.id} document={document} busy={busy} action={action} upload={upload} />)}
            </ul> : <p className="empty">Upload a text-based PDF to give your assistant something to answer from.</p>}
          </section>
          <section className="panel">
            <h2>Visitor assistant</h2>
            <p className="muted">Share this link with visitors. Answers can quote your uploaded documents.</p>
            {data.assistantNeedsRegeneration && <p className="error" role="alert">
              The saved assistant link could not be opened. Regenerate it to get a new shareable link.
            </p>}
            {url && <>
              <label>Assistant URL<input readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
              <div className="actions">
                <a className="button" href={url} target="_blank" rel="noreferrer">Open assistant</a>
                <button onClick={() => void copy(url, "Link")}>Copy link</button>
              </div>
              <label>Embed code<textarea readOnly value={embed} rows={4} onFocus={event => event.currentTarget.select()} /></label>
              <div className="actions"><button onClick={() => void copy(embed, "Embed code")}>Copy embed</button></div>
            </>}
            <button className="primary" disabled={busy} onClick={() => {
              if ((!url && !data.assistantNeedsRegeneration) || window.confirm("Generate a new link? Existing links and embeds will stop working.")) action("/api/admin/assistant", "POST");
            }}>{url || data.assistantNeedsRegeneration ? "Regenerate token" : "Generate assistant link"}</button>
          </section>
        </div>
      </>}
    </main>
  </>;
}
