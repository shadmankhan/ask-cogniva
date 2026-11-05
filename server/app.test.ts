import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { organizations } from "../fixtures/demo.js";
import { createFixturePdf } from "../fixtures/pdf.js";
import type { Answer, DocumentInfo } from "../shared/contracts.js";
import { createApp } from "./app.js";
import type { Models } from "./models.js";
import { RequestError, type Passage } from "./store.js";

const origin = "http://localhost:5173";
const json = (body: unknown) => ({ headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

function fakeModels() {
  const calls: { name: string; passages: Passage[] }[] = [];
  const stub: { fail: string; noul: number; badQuote: boolean; plan?: (question: string, passages: Passage[]) => unknown; calls: typeof calls; decisions: number; models: Models } = {
    fail: "",
    noul: 0.82,
    badQuote: false,
    calls,
    decisions: 0,
    models: {
      async generate(name, _schema, _instructions, input) {
        const { question, passages } = input as { question: string; passages: Passage[] };
        calls.push({ name, passages });
        if (stub.fail === name) throw new RequestError(503, "Language model unavailable.");
        if (name === "question_plan") {
          return stub.plan?.(question, passages) ??
            { kind: "factual", evidenceIds: passages.map(p => p.id), policy: "", scope: { evidenceId: "", quote: "" }, combine: "none", conditions: [] };
        }
        if (/compare/i.test(question)) {
          const claims = ["The Access Bursary award is 750 credits.", "The Academic Merit Scholarship award is 2,000 credits."]
            .map(quote => ({ text: quote, quote, evidenceId: passages.find(p => p.text.includes(quote))!.id }));
          return { status: "answered", claims: [...claims, {
            text: "The difference is 1,250 credits.", evidenceId: "E1,E2", quote: "A combined citation is invalid.",
          }] };
        }
        const passage = passages.find(p => p.text.includes("OBSERVATORY-17")) ?? passages[0];
        const quote = passage.text.includes("OBSERVATORY-17")
          ? "The Northbridge library desk code is OBSERVATORY-17."
          : passage.text.replace(/^[#*\s]+/, "").split("\n")[0];
        return { status: "answered", claims: [{
          text: quote, evidenceId: passage.id, quote: stub.badQuote ? "This is an invented quotation." : quote,
        }] };
      },
      async decide(_state, questions) {
        stub.decisions++;
        if (stub.fail === "laya") throw new RequestError(503, "Laya unavailable.");
        return "scope" in questions
          ? { scope: { type: "choice", choice: "applies", probabilities: { applies: 0.94 } } }
          : { check: { type: "noul", noul: stub.noul } };
      },
    } satisfies Models,
  };
  return stub;
}

async function setup(context: TestContext) {
  const db = new DatabaseSync(":memory:");
  context.after(() => db.close());
  const stub = fakeModels();
  const { app } = await createApp({ db, origin, secret: randomBytes(32).toString("hex"), models: stub.models });
  const request = (path: string, init: RequestInit = {}) => app.request(origin + path, init);
  async function organization(name: string) {
    const signup = await request("/api/auth/sign-up/email", {
      ...json({ name, email: `${name}@example.test`, password: randomUUID() }), method: "POST",
    });
    assert.equal(signup.status, 200, await signup.clone().text());
    const cookie = signup.headers.getSetCookie().find(item => item.includes("session_token="))?.split(";")[0];
    assert.ok(cookie);
    const headers = { Cookie: cookie, Origin: origin };
    const created = await request("/api/auth/organization/create", {
      ...json({ name, slug: name }), method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    });
    assert.equal(created.status, 200, await created.clone().text());
    const rotate = async () => {
      const response = await request("/api/admin/assistant", { method: "POST", headers });
      assert.equal(response.status, 200);
      return (await response.json()).token as string;
    };
    const token = await rotate();
    return { headers, token, rotate };
  }
  async function upload(headers: HeadersInit, bytes: Uint8Array, name = "Test.pdf", replaces?: string) {
    const form = new FormData();
    form.set("file", new File([Buffer.from(bytes)], name, { type: "application/pdf" }));
    return request(replaces ? `/api/admin/documents/${replaces}` : "/api/admin/documents", {
      method: replaces ? "PUT" : "POST", headers, body: form,
    });
  }
  const ask = (token: string, question: string) => request("/api/ask", { ...json({ token, question }), method: "POST" });
  return { stub, request, organization, upload, ask };
}

test("signup, tenant-isolated retrieval and file access, token rotation, and deletion", async t => {
  const { stub, request, organization, upload, ask } = await setup(t);
  const a = await organization("northbridge");
  const b = await organization("harborlight");
  const file = organizations[0].files[1];
  const added = await upload(a.headers, await createFixturePdf([["Unrelated section", "Photography tips."], file.pages[0]]), file.name);
  assert.equal(added.status, 201, await added.clone().text());
  const { document } = await added.json() as { document: DocumentInfo };
  assert.equal(document.pages, 2);
  assert.equal((await upload(b.headers, await createFixturePdf(organizations[1].files[1].pages))).status, 201);
  const foreign = `/api/admin/documents/${document.id}/file`;
  assert.equal((await request(foreign, { headers: a.headers })).status, 200);
  assert.equal((await request(foreign, { headers: b.headers })).status, 404);
  assert.equal((await request(foreign)).status, 401);
  assert.equal((await request("/api/admin/dashboard", { headers: { Authorization: "Bearer " + a.token } })).status, 401);
  assert.equal((await request(`/api/admin/documents/${document.id}`, { method: "DELETE", headers: b.headers })).status, 404);
  const question = "What is the Northbridge library desk code?";
  const answer = await ask(a.token, question);
  assert.equal(answer.status, 200, await answer.clone().text());
  const grounded = await answer.json() as Answer;
  assert.match(grounded.text, /OBSERVATORY-17/);
  assert.deepEqual(grounded.references.map(ref => [ref.name, ref.page]), [[file.name, 2]]);
  const outside = await (await ask(b.token, "OBSERVATORY-17")).json() as Answer;
  assert.equal(outside.status, "no_answer");
  assert.ok(stub.calls.every(call => call.passages.every(p => !p.text.includes("Harborlight"))));
  const newToken = await a.rotate();
  assert.equal((await ask(a.token, question)).status, 401);
  assert.equal((await ask(newToken, "")).status, 400);
  assert.equal((await request(`/api/admin/documents/${document.id}`, { method: "DELETE", headers: a.headers })).status, 200);
  assert.equal((await (await ask(newToken, question)).json() as Answer).status, "no_answer");
});

test("enforces upload limits and retains indexed evidence after a failed replacement", async t => {
  const { request, organization, upload, ask } = await setup(t);
  const a = await organization("northbridge");
  const bytes = await createFixturePdf(organizations[0].files[1].pages);
  assert.equal((await upload(a.headers, new Uint8Array([1, 2, 3]))).status, 422);
  assert.equal((await upload(a.headers, new Uint8Array(10_000_001))).status, 413);
  const tooLong = await createFixturePdf(Array.from({ length: 21 }, () => ["Page", "Sample text"]));
  assert.equal((await upload(a.headers, tooLong)).status, 422);
  const original = await (await upload(a.headers, bytes)).json() as { document: DocumentInfo };
  const blank = await createFixturePdf([[]]);
  const replacement = await upload(a.headers, blank, "Replacement.pdf", original.document.id);
  assert.equal(replacement.status, 422);
  const pending = await replacement.json() as { document: DocumentInfo };
  assert.equal(pending.document.status, "failed");
  assert.equal((await request(`/api/admin/documents/${pending.document.id}/retry`, { method: "POST", headers: a.headers })).status, 422);
  assert.equal((await (await ask(a.token, "What is the OBSERVATORY-17 desk code?")).json() as Answer).status, "answered");
  assert.equal((await request(`/api/admin/documents/${pending.document.id}`, { method: "DELETE", headers: a.headers })).status, 200);
  for (let i = 1; i < 10; i++) assert.equal((await upload(a.headers, bytes, `Copy ${i}.pdf`)).status, 201);
  assert.equal((await upload(a.headers, bytes)).status, 409);
  assert.equal((await upload(a.headers, bytes, "Fresh.pdf", original.document.id)).status, 201);
  assert.equal((await request(`/api/admin/documents/${original.document.id}/file`, { headers: a.headers })).status, 404);
});

test("decision conditions and thresholds come from the uploaded policy", async t => {
  const { stub, organization, upload, ask } = await setup(t);
  const org = await organization("makerspace");
  const title = "Laser Cutter Booking Policy";
  const safety = "Members must complete laser cutter safety orientation.";
  const policy = async (minutes: number) => createFixturePdf([[
    title, safety, `Laser cutter reservations have a maximum of ${minutes} minutes.`,
  ]]);
  const uploaded = await upload(org.headers, await policy(90));
  assert.equal(uploaded.status, 201);
  const { document } = await uploaded.json() as { document: DocumentInfo };

  let badRule = false;
  let truncatedFact = false;
  stub.plan = (question, passages) => {
    const passage = passages.find(p => p.text.includes(title))!;
    const evidenceId = passage.id;
    return {
      kind: "decision", evidenceIds: [evidenceId],
      policy: title, scope: { evidenceId, quote: title }, combine: "all",
      conditions: [
          {
            label: "Requested duration", rule: {
              evidenceId,
              quote: badRule ? "Laser cutter bookings have no limits."
                : passage.text.match(/Laser cutter reservations have a maximum of \d+ minutes\./)![0],
            },
            fact: truncatedFact ? "6" : question.match(/\b(?:60 minutes|1 hour)\b/)?.[0] ?? "",
            predicate: "", expected: true,
          },
          {
            label: "Safety orientation", rule: { evidenceId, quote: safety },
            fact: "I completed laser cutter safety orientation.",
            predicate: "Has the visitor completed safety orientation?", expected: true,
          },
      ],
    };
  };

  const question = "Can I reserve the laser cutter for 60 minutes? I completed laser cutter safety orientation.";
  const answer = await ask(org.token, question);
  assert.equal(answer.status, 200, await answer.clone().text());
  const result = await answer.json() as Answer;
  assert.equal(result.decision?.verdict, "Conditions met");
  assert.deepEqual(result.decision?.checks.map(check => check.method), ["Choice", "Rule", "Boolean (Noul)"]);

  stub.noul = 0.48;
  assert.equal((await (await ask(org.token, question)).json() as Answer).decision?.verdict, "Uncertain");
  stub.noul = 0.82;
  const differentUnits = await ask(org.token, question.replace("60 minutes", "1 hour"));
  assert.equal((await differentUnits.json() as Answer).decision?.verdict, "Uncertain");
  const before = stub.decisions;
  truncatedFact = true;
  const partialFact = await ask(org.token, question);
  assert.equal((await partialFact.json() as Answer).decision, undefined);
  truncatedFact = false;
  const missing = await ask(org.token, question.replace(" for 60 minutes", ""));
  assert.equal((await missing.json() as Answer).status, "needs_clarification");
  badRule = true;
  const unresolved = await (await ask(org.token, question)).json() as Answer;
  assert.match(unresolved.text, /couldn’t verify a decision/);
  assert.equal(unresolved.decision, undefined);
  assert.equal(stub.decisions, before);
  badRule = false;

  assert.equal((await upload(org.headers, await policy(45), "Updated.pdf", document.id)).status, 201);
  assert.equal((await (await ask(org.token, question)).json() as Answer).decision?.verdict, "Conditions not met");

  stub.fail = "laya";
  assert.equal((await ask(org.token, question)).status, 503);
  stub.fail = "question_plan";
  assert.equal((await ask(org.token, question)).status, 503);
  stub.fail = "";
  stub.plan = undefined;
  stub.badQuote = true;
  const unsupported = await (await ask(org.token, "What is the laser cutter maximum duration?")).json() as Answer;
  assert.equal(unsupported.status, "no_answer");
  assert.deepEqual(unsupported.references, []);
});

test("a comparison retains both independently grounded facts and excludes an invalid combined claim", async t => {
  const { organization, upload, ask } = await setup(t);
  const a = await organization("northbridge");
  for (const file of organizations[0].files) {
    assert.equal((await upload(a.headers, await createFixturePdf(file.pages), file.name)).status, 201);
  }
  const response = await ask(a.token, "Compare the amounts of the Academic Merit Scholarship and the Access Bursary.");
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as Answer;
  assert.match(result.text, /750 credits/);
  assert.match(result.text, /2,000 credits/);
  assert.doesNotMatch(result.text, /1,250/);
  assert.deepEqual(result.references.map(ref => [ref.name, ref.page]), [
    ["Library and Access Bursary.pdf", 2], ["Merit Scholarship Rules.pdf", 2],
  ]);
});
