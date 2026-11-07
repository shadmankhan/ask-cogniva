import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { setTimeout as pause } from "node:timers/promises";
import { createApp } from "../server/app.js";
import { createModels, type Models } from "../server/models.js";
import { RequestError } from "../server/store.js";
import type { Answer } from "../shared/contracts.js";
import { organizations } from "../fixtures/demo.js";
import { createFixturePdf } from "../fixtures/pdf.js";

const {values} = parseArgs({options: {
  provider: {type: "string", default: "ollama"}, model: {type: "string"},
  cases: {type: "string"}, data: {type: "string", default: "fixtures/knowledge-base"},
  questions: {type: "string"}, demo: {type: "boolean", default: false},
  report: {type: "string", default: "data/evaluation/latest.json"},
  "max-cloud-calls": {type: "string", default: "12"},
}});
const provider = values.provider;
assert.ok(provider === "ollama" || provider === "openrouter" || provider === "gemini", "Choose ollama, openrouter or gemini.");
const model = values.model ?? (provider === "ollama" ? process.env.OLLAMA_MODEL ?? "qwen3:1.7b-q4_K_M"
  : provider === "gemini" ? process.env.GOOGLE_GEMINI_MODEL ?? "gemini-3.1-flash-lite"
    : process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-super-vl:free");
const cap = Number(values["max-cloud-calls"]);
assert.ok(Number.isInteger(cap) && cap > 0 && cap <= 60, "Cloud call cap must be between 1 and 60.");
if (provider === "openrouter") {
  const response = await fetch("https://openrouter.ai/api/v1/models", {signal: AbortSignal.timeout(10_000)});
  assert.ok(response.ok, "Could not verify free model pricing.");
  const {data} = await response.json() as {data: {id: string; pricing: {prompt: string; completion: string}}[]};
  const entry = data.find(item => item.id === model);
  assert.ok(model.endsWith(":free") && entry && Number(entry.pricing.prompt) === 0 && Number(entry.pricing.completion) === 0,
    "Evaluation permits only verified zero-price OpenRouter models; paid fallbacks are disabled.");
}
const layaUrl = process.env.LAYA_URL ?? "http://127.0.0.1:8000";
assert.ok((await fetch(new URL("/health", layaUrl), {signal: AbortSignal.timeout(5_000)})).ok, "Start npm run laya and wait for warm-up.");
const upstream = createModels(provider === "ollama"
  ? {provider, model, ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434", layaUrl}
  : {provider, model, apiKey: provider === "gemini" ? process.env.GOOGLE_GEMINI_API_KEY : process.env.OPENROUTER_API_KEY, layaUrl});
type Case = {id: string; org: string; question: string; status?: string; verdict?: string; contains?: string[]; containsAny?: string[][]};
type Run = Case & {http: number; answer: unknown; ms: number; pass: boolean; calls: {stage: string; ms: number; result?: unknown; error?: string}[]};
const selected = values.cases?.split(",");
const cases = (JSON.parse(await readFile(resolve(values.questions ?? (values.demo ? "fixtures/decision-evaluation.json" : "fixtures/evaluation.json")), "utf8")) as Case[])
  .filter(item => !selected || selected.includes(item.id));
assert.ok(cases.length, "No matching evaluation cases.");
let current: Run;
let calls = 0;
let lastCall = 0;
let stopped: string | undefined;
const models: Models = {
  async generate(...args) {
    const start = Date.now();
    try {
      if (provider !== "ollama") {
        if (calls >= cap) throw new RequestError(503, "Evaluation cloud call cap reached.");
        await pause(Math.max(0, (provider === "gemini" ? 13_000 : 3_100) - (Date.now() - lastCall)));
        lastCall = Date.now();
        calls++;
      }
      const result = await upstream.generate(...args);
      current.calls.push({stage: args[0], ms: Date.now() - start, result});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Model request failed.";
      current.calls.push({stage: args[0], ms: Date.now() - start, error: message});
      if (/rate limited|call cap reached/i.test(message)) stopped = message;
      throw error;
    }
  },
  async decide(...args) {
    const start = Date.now();
    const result = await upstream.decide(...args);
    current.calls.push({stage: "laya", ms: Date.now() - start, result});
    return result;
  },
};
const db = new DatabaseSync(":memory:");
const origin = "http://localhost:5173";
const fingerprint = createHash("sha256");
for (const path of ["ask", "grounding", "policy", "models", "store", "rules"]) fingerprint.update(await readFile(new URL(`../server/${path}.ts`, import.meta.url)));
const report = {startedAt: new Date().toISOString(), implementation: fingerprint.digest("hex"), provider, model, cloudCalls: 0, stopped: undefined as string | undefined, cases: [] as Run[]};
try {
  const {app} = await createApp({db, models, origin, secret: randomBytes(32).toString("hex")});
  const post = (path: string, body: unknown, cookie?: string) => app.request(origin + path, {
    method: "POST", headers: {Origin: origin, "Content-Type": "application/json", ...(cookie ? {Cookie: cookie} : {})}, body: JSON.stringify(body),
  });
  const tokens = new Map<string, string>();
  for (const [index, org] of [...new Set(cases.map(item => item.org))].entries()) {
    const signup = await post("/api/auth/sign-up/email", {name: org, email: `eval${index}@example.test`, password: randomUUID()});
    assert.equal(signup.status, 200, "Evaluation account creation failed.");
    const cookie = signup.headers.getSetCookie().find(item => item.includes("session_token="))?.split(";")[0];
    assert.ok(cookie);
    assert.equal((await post("/api/auth/organization/create", {name: org, slug: `eval-${index}`}, cookie)).status, 200);
    const folder = resolve(values.data!, org);
    const sample = values.demo ? organizations.find(item => item.name === org) : undefined;
    if (values.demo) assert.ok(sample, `No original demo fixtures for ${org}.`);
    const files = sample ? await Promise.all(sample.files.map(async file => ({name: file.name, bytes: Buffer.from(await createFixturePdf(file.pages))})))
      : await Promise.all((await readdir(folder)).filter(name => name.toLowerCase().endsWith(".pdf")).sort().map(async name => ({name, bytes: await readFile(resolve(folder, name))})));
    for (const file of files) {
      const form = new FormData();
      form.set("file", new File([file.bytes], file.name, {type: "application/pdf"}));
      const uploaded = await app.request(origin + "/api/admin/documents", {method: "POST", headers: {Cookie: cookie, Origin: origin}, body: form});
      assert.equal(uploaded.status, 201, `Could not index ${org}/${file.name}: ${await uploaded.clone().text()}`);
    }
    const issued = await post("/api/admin/assistant", {}, cookie);
    tokens.set(org, (await issued.json()).token);
  }
  for (const item of cases) {
    current = {...item, http: 0, answer: undefined, ms: 0, pass: false, calls: []};
    const start = Date.now();
    console.log(`Testing ${item.id}: ${item.question}`);
    const response = await post("/api/ask", {token: tokens.get(item.org), question: item.question});
    const answer = await response.json() as Answer;
    current.http = response.status;
    current.answer = answer;
    current.ms = Date.now() - start;
    current.pass = response.ok && (!item.status || item.status === answer.status) &&
      (!item.verdict || item.verdict === answer.decision?.verdict) &&
      (!item.contains || item.contains.every(term => answer.text?.toLowerCase().includes(term.toLowerCase()))) &&
      (!item.containsAny || item.containsAny.every(group => group.some(term => answer.text?.toLowerCase().includes(term.toLowerCase()))));
    report.cases.push(current);
    report.cloudCalls = calls;
    report.stopped = stopped;
    await mkdir(dirname(resolve(values.report!)), {recursive: true});
    await writeFile(values.report!, JSON.stringify(report, null, 2) + "\n", {mode: 0o600});
    console.log(`${current.pass ? "PASS" : "FAIL"} ${item.id} (${(current.ms / 1000).toFixed(1)}s)`);
    if (stopped) break;
  }
  const passed = report.cases.filter(item => item.pass).length;
  console.log(`${passed}/${report.cases.length} checks passed. ${cases.length - report.cases.length} not run. Report: ${values.report}`);
  console.log("Checks are coarse acceptance checks; review the recorded answers, references, and decisions.");
  if (stopped || passed !== cases.length) process.exitCode = 1;
} finally {
  db.close();
}
