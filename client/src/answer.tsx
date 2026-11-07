import { Fragment, memo, type ReactNode } from "react";
import { defineCatalog, type Spec } from "@json-render/core";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { z } from "zod";
import type { Answer, DecisionCheck, Reference } from "../../shared/contracts.js";

const statusSchema = z.enum(["answered", "no_answer", "needs_clarification", "unresolved", "acknowledged"]);
const verdictSchema = z.enum(["Conditions met", "Conditions not met", "Uncertain"]);
const referenceSchema = z.object({ id: z.string(), name: z.string(), page: z.number().int().positive(), quote: z.string() });
const checkSchema = z.object({ label: z.string(), method: z.enum(["Choice", "Boolean (Noul)", "Rule"]), result: z.string(), score: z.number().optional() });
const answerViewSchema = z.object({
  status: statusSchema,
  text: z.string(),
  references: z.array(referenceSchema),
  decision: z.object({ verdict: verdictSchema, checks: z.array(checkSchema) }).optional(),
});

const catalog = defineCatalog(schema, {
  components: {
    AnswerCard: { props: z.object({ status: statusSchema, verdict: verdictSchema.nullable() }), slots: ["default"] },
    CitedText: { props: z.object({ text: z.string(), references: z.array(referenceSchema), prefix: z.string() }) },
    Sources: { props: z.object({ references: z.array(referenceSchema), prefix: z.string() }) },
    DecisionChecks: { props: z.object({ checks: z.array(checkSchema) }) },
  },
  actions: {},
});

type StatusProps = { status: Answer["status"]; verdict: NonNullable<Answer["decision"]>["verdict"] | null };
function AnswerCard({ status, verdict, children, fallback = false }: StatusProps & { children?: ReactNode; fallback?: boolean }) {
  const labels = {
    answered: "Answer from documents", no_answer: "No supported answer", needs_clarification: "More details needed",
    unresolved: "Needs review", acknowledged: "Message",
  };
  const label = status === "answered" && verdict ? verdict : labels[status] ?? "Response";
  const tone = status === "unresolved" || status === "needs_clarification" || status === "answered" && verdict === "Uncertain" ? "review"
    : status === "answered" && verdict === "Conditions not met" ? "negative"
      : status === "answered" && verdict === "Conditions met" ? "positive" : "neutral";
  return <div className="answer-content" data-fallback={fallback || undefined}>
    <span className="answer-status" data-tone={tone}>{label}</span>
    {children}
  </div>;
}

function pageLabel(page: number) {
  return Number.isInteger(page) && page > 0 ? `page ${page}` : "source excerpt";
}

function citationLabel(ref: Reference) {
  return Number.isInteger(ref.page) && ref.page > 0 ? `${ref.name} · p. ${ref.page}` : ref.name;
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`);
}

/** Opens the matching source card without changing the assistant token fragment. */
export function revealSource(prefix: string, id: string, root: ParentNode = document) {
  const source = root.querySelector(`#${cssEscape(`${prefix}-${id}`)}`);
  if (!source) return false;
  const details = source.closest("details");
  if (details) details.open = true;
  if ("scrollIntoView" in source && typeof source.scrollIntoView === "function") {
    source.scrollIntoView({ block: "nearest" });
  }
  if ("focus" in source && typeof source.focus === "function") {
    source.focus({ preventScroll: true });
  }
  return true;
}

function CitedText({ text, references, prefix }: { text: string; references: Reference[]; prefix: string }) {
  return <div className="answer-text">{text.split("\n\n").map((paragraph, p) => <p key={p}>
    {paragraph.split(/(\[\[E\d+\]\])/g).map((part, i) => {
      if (/^\[\[E\d+\]\]$/.test(part)) {
        const ref = references.find(item => part === `[[${item.id}]]`);
        if (!ref) return null;
        return <a key={i} className="citation" href={`#${prefix}-${ref.id}`}
          aria-label={`Read ${ref.name}, ${pageLabel(ref.page)}`} onClick={event => {
            // Preserve the assistant token in the URL fragment, including inside an iframe.
            event.preventDefault();
            revealSource(prefix, ref.id);
          }}>{citationLabel(ref)}</a>;
      }
      return part ? <Fragment key={i}>{part}</Fragment> : null;
    })}
  </p>)}</div>;
}

function Sources({ references, prefix }: { references: Reference[]; prefix: string }) {
  if (!references.length) return null;
  return <details className="answer-sources">
    <summary>Sources <span className="detail-count">{references.length}</span></summary>
    <div className="source-list">{references.map(ref => <blockquote className="source-card" key={ref.id}
      id={`${prefix}-${ref.id}`} tabIndex={-1}>
      <div className="source-heading"><strong>{ref.name}</strong>
        {Number.isInteger(ref.page) && ref.page > 0 ? <span>Page {ref.page}</span> : null}
      </div>
      <p>{ref.quote}</p>
    </blockquote>)}</div>
  </details>;
}

function DecisionChecks({ checks }: { checks: DecisionCheck[] }) {
  if (!checks.length) return null;
  return <details className="answer-decision">
    <summary>How Cogniva decided <span className="detail-count">{checks.length} checks</span></summary>
    <ul>{checks.map((check, i) => <li key={i}>
      <strong>{check.label}</strong>
      <div className="check-details"><span className="check-result" data-result={check.result}>{check.result}</span>
        <span>{check.method}{check.score === undefined ? "" : ` · model output ${check.score.toFixed(2)}`}</span>
      </div>
    </li>)}</ul>
  </details>;
}

const { registry } = defineRegistry(catalog, {
  components: {
    AnswerCard: ({ props, children }) => <AnswerCard {...props}>{children}</AnswerCard>,
    CitedText: ({ props }) => <CitedText {...props} />,
    Sources: ({ props }) => <Sources {...props} />,
    DecisionChecks: ({ props }) => <DecisionChecks {...props} />,
  },
});

// Only verified API data selects these fixed blocks. No model-generated UI or extra AI request.
export function answerSpec(answer: Answer, prefix: string): Spec {
  const elements: Spec["elements"] = {
    card: { type: "AnswerCard", props: { status: answer.status, verdict: answer.decision?.verdict ?? null }, children: ["text"] },
    text: { type: "CitedText", props: { text: answer.text, references: answer.references, prefix }, children: [] },
  };
  if (answer.references.length) {
    elements.sources = { type: "Sources", props: { references: answer.references, prefix }, children: [] };
    elements.card.children!.push("sources");
  }
  if (answer.decision?.checks.length) {
    elements.checks = { type: "DecisionChecks", props: { checks: answer.decision.checks }, children: [] };
    elements.card.children!.push("checks");
  }
  return { root: "card", elements };
}

function canRenderCatalog(answer: Answer, prefix: string) {
  // catalog.validate checks the tree shape; answerViewSchema enforces the component prop contracts.
  return answerViewSchema.safeParse(answer).success && catalog.validate(answerSpec(answer, prefix)).success;
}

function FallbackAnswer({ answer, prefix }: { answer: Answer; prefix: string }) {
  return <AnswerCard status={answer.status} verdict={answer.decision?.verdict ?? null} fallback>
    <CitedText text={answer.text} references={answer.references} prefix={prefix} />
    <Sources references={answer.references} prefix={prefix} />
    <DecisionChecks checks={answer.decision?.checks ?? []} />
  </AnswerCard>;
}

export const AnswerView = memo(function AnswerView({ answer, index }: { answer: Answer; index: number }) {
  const prefix = `answer-${index}`;
  if (!canRenderCatalog(answer, prefix)) {
    // Keep the response and evidence readable if a future API shape exceeds the UI catalog.
    return <FallbackAnswer answer={answer} prefix={prefix} />;
  }
  return <JSONUIProvider registry={registry}><Renderer spec={answerSpec(answer, prefix)} registry={registry} /></JSONUIProvider>;
});
