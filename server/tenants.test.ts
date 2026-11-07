import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createApp } from "./app.js";
import type { Models } from "./models.js";
import type { Passage } from "./store.js";
import type { Answer, DocumentInfo } from "../shared/contracts.js";

test("all nine real fixture PDFs stay isolated across three organizations", async t => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const origin = "http://localhost:5173";
  const tenants = [
    {name: "Northbridge University", code: "NORTH-17"},
    {name: "Harborlight Makerspace", code: "HARBOR-42"},
    {name: "Cedar Grove Museum", code: "CEDAR-63"},
  ].map(item => ({...item, id: "", cookie: "", token: "", email: "", password: randomUUID(), documents: [] as DocumentInfo[]}));
  let active = tenants[0];
  let modelInputs = 0;
  const models: Models = {
    async generate(stage, _schema, _instructions, input) {
      if (stage === "answer_review") {
        const {claims, passages} = input as {claims: {id: string; candidateQuote: string}[]; passages: Passage[]};
        for (const passage of passages) {
          assert.ok(active.documents.some(doc => doc.name === passage.name));
          for (const other of tenants.filter(item => item !== active)) assert.ok(!passage.text.includes(other.code));
        }
        modelInputs++;
        return Object.fromEntries(claims.map(claim => [claim.id, {supported: "yes", relevant: "yes", quoteRelevant: "yes", quote: claim.candidateQuote}]));
      }
      const {question, passages} = input as {question: string; passages: Passage[]};
      modelInputs++;
      assert.ok(passages.length > 0);
      for (const passage of passages) {
        assert.ok(active.documents.some(doc => doc.name === passage.name), "Only the active organization's source names reach the model");
        for (const other of tenants.filter(item => item !== active)) assert.ok(!passage.text.includes(other.code), "Foreign source content must never reach the model");
      }
      if (stage === "question_plan") return {kind: "factual", policy: "", evidenceIds: passages.map(p => p.id)};
      assert.equal(stage, "grounded_answer");
      const requested = tenants.find(item => question.includes(item.code))!;
      const source = passages.find(passage => passage.text.includes(requested.code));
      const quote = source?.text.split("\n").find(line => line.includes(requested.code))?.trim();
      return {parts: [{question, claims: source && quote ? [{text: quote, quote, evidenceId: source.id}] : []}]};
    },
    async decide(states, questions) {
      return states.map(() => Object.fromEntries(Object.keys(questions).map(key => [key, {type: "noul", noul: 0.99}])));
    },
  };
  const {app, store} = await createApp({db, models, origin, secret: randomBytes(32).toString("hex")});
  const request = (path: string, init: RequestInit = {}) => app.request(origin + path, init);
  const post = (path: string, body: unknown, cookie?: string) => request(path, {
    method: "POST", headers: {Origin: origin, "Content-Type": "application/json", ...(cookie ? {Cookie: cookie} : {})}, body: JSON.stringify(body),
  });
  for (const [index, tenant] of tenants.entries()) {
    tenant.email = `tenant${index}@example.test`;
    const signup = await post("/api/auth/sign-up/email", {name: tenant.name, email: tenant.email, password: tenant.password});
    assert.equal(signup.status, 200);
    tenant.cookie = signup.headers.getSetCookie().find(value => value.includes("session_token="))!.split(";")[0];
    const created = await post("/api/auth/organization/create", {name: tenant.name, slug: `audit-${index}`}, tenant.cookie);
    assert.equal(created.status, 200);
    tenant.id = (await created.json()).id;
    const folder = new URL(`../fixtures/knowledge-base/${tenant.name}/`, import.meta.url);
    const files = (await readdir(folder)).filter(name => name.endsWith(".pdf"));
    assert.equal(files.length, 3);
    for (const name of files) {
      const bytes = await readFile(new URL(name, folder));
      const form = new FormData();
      form.set("file", new File([bytes], name, {type: "application/pdf"}));
      const uploaded = await request("/api/admin/documents", {method: "POST", headers: {Cookie: tenant.cookie, Origin: origin}, body: form});
      assert.equal(uploaded.status, 201);
      const {document} = await uploaded.json() as {document: DocumentInfo};
      assert.equal(document.status, "ready");
      assert.equal(document.pages, 1);
      tenant.documents.push(document);
      const ownFile = await request(`/api/admin/documents/${document.id}/file`, {headers: {Cookie: tenant.cookie}});
      assert.equal(ownFile.status, 200);
      assert.deepEqual(Buffer.from(await ownFile.arrayBuffer()), bytes);
    }
    tenant.token = (await (await post("/api/admin/assistant", {}, tenant.cookie)).json()).token;
  }
  assert.equal(new Set(tenants.map(item => item.token)).size, 3);

  for (const tenant of tenants) {
    active = tenant;
    const dashboard = await request("/api/admin/dashboard", {headers: {Cookie: tenant.cookie}});
    assert.equal(dashboard.status, 200);
    assert.deepEqual(new Set((await dashboard.json()).documents.map((doc: DocumentInfo) => doc.id)), new Set(tenant.documents.map(doc => doc.id)));
    assert.equal((await request("/api/admin/dashboard", {headers: {Authorization: `Bearer ${tenant.token}`}})).status, 401);
    const identity = await post("/api/assistant", {token: tenant.token, organizationName: "Spoofed", org_id: tenants.find(other => other !== tenant)!.id});
    assert.deepEqual(await identity.json(), {organizationName: tenant.name});

    const ids = new Set(tenant.documents.map(doc => doc.id));
    const queries = [...tenants.map(item => item.code), "policy scholarship booking safety group tour"];
    for (const query of queries) {
      const hits = store.search(tenant.id, query);
      if (query === tenant.code) assert.ok(hits.length > 0);
      for (const hit of [...hits, ...store.policyContext(tenant.id, hits)]) assert.ok(ids.has(hit.documentId!), "Search and policy expansion must remain tenant-scoped");
    }
    for (const target of tenants) {
      const before = modelInputs;
      const response = await post("/api/ask", {token: tenant.token, question: `What is the desk reference ${target.code}?`, org_id: target.id});
      assert.equal(response.status, 200);
      const answer = await response.json() as Answer;
      if (target === tenant) {
        assert.equal(answer.status, "answered");
        assert.ok(answer.text.includes(tenant.code));
        assert.ok(modelInputs > before, "Positive cases must actually exercise retrieved model input");
        assert.ok(answer.references.length > 0);
      } else {
        assert.equal(answer.status, "no_answer");
        assert.deepEqual(answer.references, []);
        assert.ok(!answer.text.includes(target.code));
      }
    }
    for (const other of tenants.filter(item => item !== tenant)) {
      for (const doc of other.documents) {
        const path = `/api/admin/documents/${doc.id}`;
        const headers = {Cookie: tenant.cookie, Origin: origin};
        assert.equal((await request(path + "/file", {headers})).status, 404);
        assert.equal((await request(path, {method: "DELETE", headers})).status, 404);
        assert.equal((await post(path + "/retry", {}, tenant.cookie)).status, 404);
        const replacement = new FormData();
        replacement.set("file", new File([await readFile(new URL(`../fixtures/knowledge-base/${other.name}/${doc.name}`, import.meta.url))], doc.name, {type: "application/pdf"}));
        assert.equal((await request(path, {method: "PUT", headers, body: replacement})).status, 404);
      }
    }
    const afterAttempts = await request("/api/admin/dashboard", {headers: {Cookie: tenant.cookie}});
    assert.deepEqual(new Set((await afterAttempts.json()).documents.map((doc: DocumentInfo) => doc.id)), ids);
  }
  assert.equal((await request(`/api/admin/documents/${tenants[0].documents[0].id}/file`)).status, 401);
  const rotated = await post("/api/admin/assistant", {}, tenants[0].cookie);
  const newToken = (await rotated.json()).token;
  assert.equal((await post("/api/assistant", {token: tenants[0].token})).status, 401);
  assert.equal((await post("/api/assistant", {token: newToken})).status, 200);
  for (const other of tenants.slice(1)) assert.equal((await post("/api/assistant", {token: other.token})).status, 200);
  assert.equal((await post("/api/auth/sign-out", {}, tenants[0].cookie)).status, 200);
  assert.equal((await request("/api/admin/dashboard", {headers: {Cookie: tenants[0].cookie}})).status, 401);
  assert.equal((await post("/api/auth/sign-in/email", {email: tenants[0].email, password: tenants[0].password})).status, 200);
});
