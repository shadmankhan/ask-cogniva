import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import { createModels } from "./models.js";
import { RequestError } from "./store.js";

const settings = {
  provider: "gemini",
  apiKey: "test-only-value",
  model: "gemini-3.1-flash-lite",
  layaUrl: "http://127.0.0.1:8000",
} as const;
const schema = Type.Object({ kind: Type.String() }, { additionalProperties: false });

test("Gemini receives the same JSON schema and returns the structured reply", async t => {
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent");
    assert.equal(new Headers(init.headers).get("x-goog-api-key"), settings.apiKey);
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(body.generationConfig.responseJsonSchema, JSON.parse(JSON.stringify(schema)));
    assert.equal(body.systemInstruction.parts[0].text, "Classify the question.");
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), { question: "When do you open?" });
    return Response.json({ candidates: [{
      finishReason: "STOP",
      content: { parts: [{ thought: true, text: "internal thought" }, { text: '{"kind":"factual"}' }] },
    }] });
  });

  assert.deepEqual(await createModels(settings).generate(
    "question_plan", schema, "Classify the question.", { question: "When do you open?" },
  ), { kind: "factual" });
});

test("Gemini reports quota errors without exposing the provider response", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("provider response", { status: 429 }));
  await assert.rejects(
    createModels(settings).generate("question_plan", schema, "Classify the question.", {}),
    (error: unknown) => error instanceof RequestError && error.status === 503 && /Gemini is rate limited/.test(error.message),
  );
});

test("Ollama sends a structured request to the local server without an API key", async t => {
  const local = { provider: "ollama", model: "qwen-test", ollamaUrl: "http://127.0.0.1:11434", layaUrl: settings.layaUrl } as const;
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(String(url), "http://127.0.0.1:11434/api/chat");
    assert.deepEqual([...new Headers(init.headers)], [["content-type", "application/json"]]);
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, local.model);
    assert.equal(body.stream, false);
    assert.deepEqual(body.format, JSON.parse(JSON.stringify(schema)));
    assert.deepEqual(body.messages, [
      { role: "system", content: "Classify the question." },
      { role: "user", content: '{"question":"When do you open?"}' },
    ]);
    return Response.json({ done: true, done_reason: "stop", message: { content: '{"kind":"factual"}' } });
  });

  assert.deepEqual(await createModels(local).generate(
    "question_plan", schema, "Classify the question.", { question: "When do you open?" },
  ), { kind: "factual" });
});
