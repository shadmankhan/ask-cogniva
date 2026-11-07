import { useEffect, useState, type FormEvent } from "react";
import { LIMITS, type Answer, type AssistantInfo } from "../../shared/contracts.js";
import { api } from "./api.js";
import { AnswerView } from "./answer.js";

export function Chat() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
  const [assistant, setAssistant] = useState<AssistantInfo>();
  const [linkError, setLinkError] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ question: string; answer: Answer }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api<AssistantInfo>("/api/assistant", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      signal: controller.signal,
    }).then(info => {
      if (controller.signal.aborted) return;
      setAssistant(info);
      document.title = `${info.organizationName} assistant | Cogniva`;
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setLinkError(failure instanceof Error ? failure.message : "Unable to open the assistant. Try again.");
      }
    });
    return () => controller.abort();
  }, [token]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asked = question.trim();
    if (!asked || busy || !token || !assistant) return;
    setBusy(true);
    setError("");
    try {
      const answer = await api<Answer>("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, question: asked }),
      });
      setMessages(current => [...current, { question: asked, answer }]);
      setQuestion("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="chat-page">
    <header className="chat-header">
      <span className="brand">{assistant?.organizationName ?? "Cogniva"}</span>
      <span className="muted">{assistant ? "Powered by Cogniva" : "Document assistant"}</span>
    </header>
    <div className="thread">
      {!token && <p className="error">Open a valid assistant link from your organization.</p>}
      {linkError && <p className="error" role="alert">{linkError}</p>}
      {token && !assistant && !linkError && <p className="muted" role="status">Opening assistant…</p>}
      {assistant && <>
        {messages.length === 0 && <div className="chat-intro">
          <span className="eyebrow">VISITOR ASSISTANT</span>
          <h1>What would you like to know?</h1>
          <p>Ask about the documents from {assistant.organizationName} and check the cited pages behind each answer.</p>
        </div>}
        {messages.map((message, i) => <section className="turn" key={i}
          aria-live={i === messages.length - 1 ? "polite" : undefined}>
          <p className="question">{message.question}</p>
          <div className="response">
            <p className="response-author">{assistant.organizationName} assistant</p>
            <AnswerView answer={message.answer} index={i} />
          </div>
        </section>)}
        {busy && <p className="muted" role="status">Searching and preparing an answer…</p>}
      </>}
    </div>
    {assistant && <form className="ask-box" onSubmit={ask}>
      {error && <p className="error" role="alert">{error}</p>}
      <label>Ask a question<textarea rows={2} value={question} maxLength={LIMITS.question} disabled={busy}
        onChange={event => setQuestion(event.target.value)} placeholder="Ask about a policy, procedure, or decision…" required /></label>
      <div className="ask-actions"><span className="muted">{question.length}/{LIMITS.question}</span>
        <button className="primary" disabled={busy || !question.trim()}>{busy ? "Working…" : "Ask Cogniva"}</button></div>
    </form>}
  </main>;
}
