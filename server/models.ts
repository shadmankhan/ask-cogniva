import { OpenRouter } from "@openrouter/sdk";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { RequestError } from "./store.js";

export interface Models {
  generate(name: string, schema: TSchema, instructions: string, input: unknown): Promise<unknown>;
  decide(state: string, questions: Record<string, unknown>): Promise<unknown>;
}

export function createModels(settings: { apiKey?: string; model: string; layaUrl: string }): Models {
  const client = settings.apiKey ? new OpenRouter({ apiKey: settings.apiKey, timeoutMs: 40_000 }) : undefined;

  return {
    async generate(name, schema, instructions, input) {
      if (!client) throw new RequestError(503, "OpenRouter is not configured. Add OPENROUTER_API_KEY to the local .env file.");
      try {
        const response = await client.chat.send({
          chatRequest: {
            model: settings.model,
            stream: false,
            maxTokens: name === "question_plan" ? 1_600 : 900,
            reasoning: { effort: name === "question_plan" ? "low" : "none" },
            provider: { requireParameters: true, allowFallbacks: false },
            responseFormat: { type: "json_schema", jsonSchema: { name, strict: true, schema } },
            messages: [
              { role: "system", content: instructions },
              { role: "user", content: JSON.stringify(input) },
            ],
          },
        }, { retries: { strategy: "none" } });
        const content = response.choices[0]?.message.content;
        if (typeof content !== "string") throw new Error("Missing model text");
        return JSON.parse(content);
      } catch (error) {
        if (typeof error === "object" && error && "statusCode" in error && error.statusCode === 429) {
          throw new RequestError(503, "OpenRouter is rate limited. Try again later.");
        }
        throw new RequestError(503, "The language model could not complete this request. Try again.");
      }
    },
    async decide(state, questions) {
      try {
        const response = await fetch(new URL("/v1/systemone", settings.layaUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "english", state, questions }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error("Decision server error");
        const data = await response.json();
        if (data.usage?.truncated) throw new Error("Decision context was truncated");
        return data.answers;
      } catch {
        throw new RequestError(503, "The local Laya decision model is unavailable. Start it and try again.");
      }
    },
  };
}

export function requireModelResult<T>(schema: TSchema, result: unknown, label: string): T {
  if (!Check(schema, result)) {
    throw new RequestError(503, `The ${label} returned an invalid result. Try again.`);
  }
  return result as T;
}
