import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { organization } from "better-auth/plugins";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { LIMITS, type Answer, type AssistantInfo } from "../shared/contracts.js";
import { answerQuestion } from "./ask.js";
import type { Models } from "./models.js";
import { openPdf, parsePdf, validatePdfBytes } from "./pdf.js";
import { createStore, RequestError } from "./store.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function assistantReply(message: string, organizationName: string): string | undefined {
  const greeting = /^(?:hi|hello|hey|good morning|good afternoon|good evening)(?: there)?(?: cogniva)?$/;
  const thanks = /^(?:(?:great|nice|awesome|perfect) )?(?:thanks|thank you)(?: (?:again|a lot|so much|very much|for (?:your help|the help|the answer|the info)))?$/;
  const praise = /^(?:(?:i )?(?:love|appreciate) (?:your|the) (?:help|service)|great|nice|awesome|perfect|helpful|thats helpful|much appreciated|youre great)$/;
  const identity = /^(?:who are you|(?:what|which) organi[sz]ation (?:is this|are you (?:answering )?for|do you (?:represent|answer for)))$/;
  const acknowledges = (clause: string) => thanks.test(clause) || praise.test(clause);
  const clauses = message.toLowerCase().replace(/['’]/g, "").split(/[.!?,;]+/)
    .map(clause => clause.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!clauses.length || !clauses.every(clause => greeting.test(clause) || acknowledges(clause) || identity.test(clause))) return;
  const introduction = `I’m the document assistant for ${organizationName}.`;
  if (clauses.some(clause => identity.test(clause))) return introduction;
  return clauses.some(acknowledges)
    ? "You’re welcome! Happy to help."
    : `Hi! ${introduction}`;
}

function tokenStorage(secret: string) {
  const key = createHash("sha256").update("cogniva-assistant:" + secret).digest();
  return {
    seal(token: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      return Buffer.concat([iv, cipher.update(token, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
    },
    unseal(sealed: string) {
      const bytes = Buffer.from(sealed, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString("utf8");
    },
  };
}

export async function createApp(settings: { db: DatabaseSync; origin: string; secret: string; models: Models }) {
  const { db, origin, secret, models } = settings;
  const authOptions = {
    database: db,
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: true },
    plugins: [organization({ organizationLimit: 1 })],
  } satisfies BetterAuthOptions;
  const migrations = await getMigrations(authOptions);
  await migrations.runMigrations();
  const auth = betterAuth(authOptions);
  const store = createStore(db);
  const tokens = tokenStorage(secret);
  const limits = new Map<string, { until: number; requests: number }>();

  const app = new Hono<{ Variables: { org: { id: string; name: string } } }>();
  app.onError((error, c) => {
    if (error instanceof RequestError) return c.json({ error: error.message }, error.status);
    console.error("Cogniva request failed", { method: c.req.method, type: error.name });
    return c.json({ error: "Something went wrong. Try again." }, 500);
  });
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    await next();
  });
  app.on(["GET", "POST"], "/api/auth/*", c => auth.handler(c.req.raw));
  app.get("/api/health", c => c.json({ status: "ok" }));

  function requireAssistant(token: unknown) {
    if (typeof token === "string" && /^[\w-]{43}$/.test(token)) {
      const org = store.tokenOrganization(hash(token));
      if (org) return org;
    }
    throw new RequestError(401, "This assistant link is invalid or has been replaced.");
  }

  app.post("/api/assistant", bodyLimit({ maxSize: 1_024 }), async c => {
    const body = await c.req.json<{ token?: unknown }>().catch(() => null);
    const org = requireAssistant(body?.token);
    return c.json<AssistantInfo>({ organizationName: org.name });
  });

  app.post("/api/ask", bodyLimit({ maxSize: 8_192 }), async c => {
    const body = await c.req.json<{ token?: unknown; question?: unknown }>().catch(() => null);
    const org = requireAssistant(body?.token);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) throw new RequestError(400, "Enter a question.");
    if (question.length > LIMITS.question) throw new RequestError(400, "Keep your question to 1,200 characters.");
    const now = Date.now();
    const counter = limits.get(org.id);
    if (counter && counter.until > now) {
      if (counter.requests >= 20) throw new RequestError(429, "Too many questions. Try again in a minute.");
      counter.requests++;
    } else {
      for (const [id, entry] of limits) if (entry.until <= now) limits.delete(id);
      limits.set(org.id, { until: now + 60_000, requests: 1 });
    }
    const acknowledgment = assistantReply(question, org.name);
    if (acknowledgment) return c.json<Answer>({ status: "acknowledged", text: acknowledgment, references: [] });
    store.count(org.id, "asked");
    const result = await answerQuestion(models, question, store.search(org.id, question));
    store.count(org.id, result.status === "answered" ? "answered" : "no_answer");
    return c.json(result);
  });

  const admin = new Hono<{ Variables: { org: { id: string; name: string } } }>();
  admin.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("Origin") !== origin) {
      return c.json({ error: "Request origin is not allowed." }, 403);
    }
    const current = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!current) throw new RequestError(401, "Sign in to manage your organization.");
    const org = store.organization(current.user.id, current.session.activeOrganizationId);
    if (!org) return c.json({ error: "Create an organization to open the dashboard.", code: "organization_required" }, 403);
    c.set("org", org);
    await next();
  });
  admin.get("/dashboard", c => {
    const org = c.get("org");
    const assistant = store.assistant(org.id);
    return c.json({
      organization: org, documents: store.list(org.id), usage: store.usage(org.id),
      token: assistant ? tokens.unseal(assistant.sealed_token) : null,
    });
  });
  admin.post("/assistant", c => {
    const token = randomBytes(32).toString("base64url");
    store.setAssistant(c.get("org").id, hash(token), tokens.seal(token));
    return c.json({ token });
  });
  admin.get("/documents/:id/file", c => {
    const file = store.file(c.get("org").id, c.req.param("id"));
    if (!file) throw new RequestError(404, "Document not found.");
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
  admin.delete("/documents/:id", c => {
    if (!store.delete(c.get("org").id, c.req.param("id"))) throw new RequestError(404, "Document not found.");
    return c.json({ deleted: true });
  });

  async function index(org: string, id: string, pdf: Awaited<ReturnType<typeof openPdf>>) {
    try {
      const parsed = await parsePdf(pdf);
      return store.publish(org, id, parsed);
    } catch (error) {
      const message = error instanceof RequestError ? error.message : "Could not process this PDF. Retry or upload another file.";
      const failed = store.failed(org, id, message);
      if (!failed) throw new RequestError(404, "Upload was removed.");
      return failed;
    }
  }

  const uploadSize = bodyLimit({
    maxSize: LIMITS.bytes + 128_000,
    onError: c => c.json({ error: "Each PDF must be 10 MB or smaller." }, 413),
  });
  admin.on(["POST", "PUT"], ["/documents", "/documents/:id"], uploadSize, async c => {
    const org = c.get("org").id;
    const form = await c.req.raw.formData().catch(() => undefined);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new RequestError(400, "Select a PDF to upload.");
    if (file.size > LIMITS.bytes) throw new RequestError(413, "Each PDF must be 10 MB or smaller.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_");
    validatePdfBytes(name, bytes);
    const pdf = await openPdf(bytes);
    const safeName = name.slice(0, -4).slice(0, 155) + ".pdf";
    const id = store.reserve(org, safeName, bytes, c.req.param("id") ?? null);
    const document = await index(org, id, pdf);
    return c.json({ document, ...(document.error ? { error: document.error } : {}) }, document.status === "ready" ? 201 : 422);
  });
  admin.post("/documents/:id/retry", async c => {
    const org = c.get("org").id;
    const id = c.req.param("id");
    const bytes = store.retry(org, id);
    let pdf;
    try {
      pdf = await openPdf(bytes);
    } catch (error) {
      store.failed(org, id, "This PDF is no longer readable. Upload a new copy.");
      throw error;
    }
    const document = await index(org, id, pdf);
    return c.json({ document, ...(document.error ? { error: document.error } : {}) }, document.status === "ready" ? 200 : 422);
  });

  app.route("/api/admin", admin);
  return { app, auth, store };
}
