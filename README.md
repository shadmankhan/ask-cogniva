# Cogniva

Cogniva gives each organization a private PDF knowledge base and a shareable assistant. Visitors can ask for information or walk through a supported policy decision and see the document pages behind the answer.

## Run locally

Install Node.js 24.15+ in the Node 24 series, npm, and Git. The local System 1 service also uses Python 3.13 and [uv](https://docs.astral.sh/uv/getting-started/installation/). Get an [OpenRouter key](https://openrouter.ai/settings/keys) or a [Gemini key](https://aistudio.google.com/apikey) for live language-model calls.

1. Run `npm ci`.
2. Copy `.env.example` to `.env` on first setup. Set `LLM_PROVIDER` to `openrouter` or `gemini` and fill in the matching API key. Keep API keys in the local file. Cogniva generates a local signing secret under `data/` and initializes the SQLite schema on startup.
3. Run `npm run seed` to create two sample organizations. It generates two text-based PDFs for each organization under `data/demo-pdfs/` and writes the local login details to `data/demo-accounts.json`. The synthetic source content and 14 test questions are in [fixtures/demo.ts](fixtures/demo.ts).
4. In separate terminals, run `npm run laya` and `npm run dev`. The first Laya startup downloads the English checkpoint. Open [the dashboard](http://localhost:5173) to register or sign in as a demo organization.
5. Run `npm run demo` in another terminal, copy the dashboard's iframe code, and paste it into [the separate demo page](http://localhost:5174).

`npm test` exercises real SQLite, authentication, PDF parsing, and the HTTP routes with deterministic model stubs. `npm run build` type-checks the application and bundles the client. To serve the bundle locally, run `COGNIVA_ORIGIN=http://localhost:3001 npm start` after building.

| Environment variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | Selects `openrouter` (default) or `gemini` for planning and answer generation. |
| `OPENROUTER_API_KEY` | Server-side credential when using OpenRouter. |
| `OPENROUTER_MODEL` | Defaults to `nvidia/nemotron-3.5-super-vl:free`. Use a model that supports strict JSON schemas. |
| `GOOGLE_GEMINI_API_KEY` | Server-side credential when using Gemini. |
| `GOOGLE_GEMINI_MODEL` | Defaults to `gemini-3.1-flash-lite`. Use a model with structured output support. |
| `LAYA_URL` | Local decision service, normally `http://127.0.0.1:8000`. |
| `PORT` | API port, normally `3001`. |
| `COGNIVA_ORIGIN` | Allowed dashboard origin, normally `http://localhost:5173`. |
| `COGNIVA_DB_PATH` | SQLite file, normally `data/cogniva.sqlite`. |
| `COGNIVA_SECRET` | Optional stable server secret of at least 32 characters. A local secret file is created otherwise. |

Change `LLM_PROVIDER` in `.env` and restart `npm run dev` to switch providers. The app uses the selected provider’s model and key. Laya handles local typed decisions with either provider.

## Architecture

```mermaid
flowchart TD
  A[Organization dashboard] -->|Admin session| B[Hono API]
  B --> C[pdf-lib and AnyDoc]
  C --> D[(SQLite PDFs, page chunks, and FTS5)]
  V[Visitor chat and iframe] -->|Assistant token| B
  B -->|Resolve organization and search| D
  D --> P[LLM planner]
  P -->|Individual decision checks| L[Local Laya Choice and Boolean]
  L --> R[TypeScript rules and verdict]
  P -->|Factual question| W[LLM answer composer]
  R --> W
  W --> S[Server citation validation]
  S --> V
```

### Knowledge base

The API validates the PDF signature, file size, page count, and organization quota. `pdf-lib` separates pages, then AnyDoc extracts Markdown locally. The server splits page text into bounded, overlapping chunks and indexes them in SQLite FTS5. Every passage keeps its original page number and document name. A ready replacement swaps in its chunks and deletes the previous version in one transaction. A failed replacement leaves the original indexed.

### AI decisions and grounding

The API resolves the tenant before retrieval. It returns a no-answer response when search finds no evidence. Otherwise the LLM planner selects evidence and classifies the question. Factual questions go straight to composition. For a decision, the planner extracts conditions and their combination from the retrieved passages. It quotes the rules from the PDFs and the visitor facts from the question.

The server validates those quotes before running a decision. Laya **Choice** evaluates whether the cited policy applies. Laya **Boolean (Noul)** evaluates individual semantic predicates. TypeScript performs explicit numeric comparisons and combines the checks using the policy's required or alternative conditions. Missing facts lead to clarification, and unsupported or ambiguous cases can be explained without a definitive verdict. The composer explains the cited rules while the UI renders the computed result and a trace of the typed outputs.

For generated claims, the model supplies a passage ID and a verbatim supporting quote. The server validates both against the retrieved ledger before returning document and page references. For multi-part questions, the composer checks each part independently. Cogniva cites the parts it can support and identifies the gaps. It returns a full no-answer only when no part is supported.

### Security

Better Auth manages email/password login and admin sessions. Administrative routes require an owner or admin membership in the resolved organization. Public assistant tokens authorize questions against one organization. The server stores a hash for token lookup and encrypts the token for redisplay in the dashboard. Rotation invalidates the old token. File downloads, replacements, deletes, and retrieval are scoped by organization. The public response includes short cited passages and a rate limit applies per assistant organization.

`.env` and the SQLite, secret, and generated demo files under `data/` are ignored by Git. The selected cloud provider receives the visitor's question and selected passages for planning and composition. Use the synthetic fixture material for the free model demo. AnyDoc and Laya run locally.

### Main API endpoints

| Endpoint | Purpose |
| --- | --- |
| `/api/auth/*` | Better Auth accounts, sessions, and organization creation. |
| `GET /api/admin/dashboard` | Organization, document statuses, usage counters, and current assistant token. |
| `POST /api/admin/assistant` | Generate or rotate the assistant token. |
| `POST /api/admin/documents` | Upload and index a PDF. |
| `GET /api/admin/documents/:id/file` | Download the original PDF with an authorized session. |
| `PUT /api/admin/documents/:id` | Upload and index a replacement. |
| `POST /api/admin/documents/:id/retry` | Retry a failed ingestion. |
| `DELETE /api/admin/documents/:id` | Delete a PDF and its index entries. |
| `POST /api/ask` | Ask a question with an assistant token. |

### Known limitations

This is a single-process local MVP with synchronous ingestion, text-based PDFs, and keyword retrieval. OCR, a worker queue for ingestion, and hybrid search would extend the supported documents and workloads. Policy decisions are limited to cases the planner can represent as a supported combination of simple checks. Conflicting, ambiguous, or complex policies may yield a cited summary or an uncertain result. Decision confidence is heuristic and needs evaluation on more labeled cases. Cloud free tiers are subject to rate limits and availability.

## Demo walkthrough

1. Sign up as a new organization, upload a PDF, and show the document status and assistant link.
2. Open the seeded Northbridge dashboard, paste its embed into the separate page, and ask when the library opens. Open the page citation.
3. Ask both multi-condition scholarship questions from the fixture list. Expand **How Cogniva decided** and explain the conditions extracted from the PDFs, Laya's outputs, and the TypeScript combination. The same workflow can process rules from other domains.
4. Ask for the Northbridge library desk code using both organizations' assistants. Northbridge has the code, while Harborlight's knowledge base gives no answer. Show a Harborlight-specific question too.
5. Explain the architecture diagram, invalid-token behavior, and the isolation tests. The assignment video is approximately 8–15 minutes.
