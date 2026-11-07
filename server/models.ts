import { OpenRouter } from "@openrouter/sdk";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { RequestError } from "./store.js";

export interface Models {
  generate(name: string, schema: TSchema, instructions: string, input: unknown): Promise<unknown>;
  decide(states: string[], questions: Record<string, unknown>): Promise<unknown[]>;
}

type GeneratorSettings = { apiKey?: string; model: string };
type OllamaSettings = { model: string; ollamaUrl: string };
type ModelSettings = (
  (GeneratorSettings & { provider: "openrouter" | "gemini" }) |
  (OllamaSettings & { provider: "ollama" })
) & { layaUrl: string };

function serial<Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>) {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args: Args): Promise<Result> => {
    const result = tail.then(() => work(...args));
    tail = result.catch(() => undefined);
    return result;
  };
}

function openRouterGenerator(settings: GeneratorSettings): Models["generate"] {
  const client = settings.apiKey ? new OpenRouter({ apiKey: settings.apiKey, timeoutMs: 40_000 }) : undefined;

  return async (name, schema, instructions, input) => {
    if (!client) throw new RequestError(503, "OpenRouter is not configured. Add OPENROUTER_API_KEY to the local .env file.");
    try {
      const response = await client.chat.send({
        chatRequest: {
          model: settings.model,
          stream: false,
          maxTokens: name === "question_plan" ? 512 : name === "policy_facts" ? 4_096 : 2_048,
          reasoning: { effort: "none" },
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
  };
}

function geminiGenerator(settings: GeneratorSettings): Models["generate"] {
  return async (name, schema, instructions, input) => {
    if (!settings.apiKey) throw new RequestError(503, "Gemini is not configured. Add GOOGLE_GEMINI_API_KEY to the local .env file.");
    try {
      const model = encodeURIComponent(settings.model);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            maxOutputTokens: name === "question_plan" ? 4_096 : 2_048,
          },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (response.status === 429) throw new RequestError(503, "Gemini is rate limited. Try again later or select another provider.");
      if (response.status === 404) throw new RequestError(503, "The configured Gemini model is unavailable. Check GOOGLE_GEMINI_MODEL.");
      if (response.status >= 500) throw new RequestError(503, "Gemini is temporarily unavailable. Try again or select another provider.");
      const data = await response.json() as {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        error?: { details?: { reason?: string }[] };
      };
      if (response.status === 401 || response.status === 403 ||
          data.error?.details?.some(detail => detail.reason === "API_KEY_INVALID")) {
        throw new RequestError(503, "Gemini rejected the API credential. Check GOOGLE_GEMINI_API_KEY.");
      }
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === "MAX_TOKENS") throw new RequestError(503, "Gemini reached its response token limit. Try a narrower question or another configured model.");
      if (!response.ok) throw new RequestError(503, "Gemini could not accept the structured request. Check the configured model and try again.");
      if (candidate?.finishReason !== "STOP") throw new RequestError(503, "Gemini ended its response without a complete answer. Try another configured model.");
      const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("");
      if (!text) throw new RequestError(503, "Gemini returned an empty answer. Try again or select another provider.");
      try {
        return JSON.parse(text);
      } catch {
        throw new RequestError(503, "Gemini returned invalid structured output. Try again or select another provider.");
      }
    } catch (error) {
      if (error instanceof RequestError) throw error;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new RequestError(503, "Gemini timed out. Try again or select another provider.");
      }
      throw new RequestError(503, "Gemini could not complete this request. Try again.");
    }
  };
}

function ollamaGenerator(settings: OllamaSettings): Models["generate"] {
  const endpoint = new URL("/api/chat", settings.ollamaUrl);
  return async (name, schema, instructions, input) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          keep_alive: 0,
          stream: false,
          think: false,
          format: schema,
          messages: [
            { role: "system", content: instructions },
            { role: "user", content: JSON.stringify(input) },
          ],
          options: { temperature: 0, num_ctx: 6_144, num_predict: name === "question_plan" || name === "numeric_facts" ? 256 : name === "policy_facts" || name === "answer_review" ? 2_048 : 1_200 },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
      });
      if (response.status === 404) throw new RequestError(503, "The Ollama model is missing. Run ollama pull with the model in OLLAMA_MODEL.");
      if (!response.ok) throw new RequestError(503, "Ollama could not run the local model. Check the Ollama server logs.");
      const result = await response.json() as { done?: boolean; done_reason?: string; message?: { content?: string } };
      if (!result.done || result.done_reason === "length" || typeof result.message?.content !== "string") {
        throw new RequestError(503, "Ollama returned an incomplete response. Try again.");
      }
      return JSON.parse(result.message.content);
    } catch (error) {
      if (error instanceof RequestError) throw error;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new RequestError(503, "Ollama timed out while running the local model. Try again.");
      }
      if (error instanceof TypeError) throw new RequestError(503, "Could not reach Ollama. Start ollama serve and check OLLAMA_URL.");
      throw new RequestError(503, "Ollama returned an invalid response. Try again.");
    }
  };
}

export function createModels(settings: ModelSettings): Models {
  const generate = settings.provider === "ollama" ? ollamaGenerator(settings)
    : settings.provider === "gemini" ? geminiGenerator(settings) : openRouterGenerator(settings);
  return {
    generate: serial(generate),
    decide: serial(async (states, questions) => {
      const answers: unknown[] = [];
      try {
        for (let index = 0; index < states.length; index += 4) {
          const batch = states.slice(index, index + 4);
          const response = await fetch(new URL("/v1/systemone/batch", settings.layaUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: "english", states: batch, batch_size: 4, max_len: 768, questions }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!response.ok) throw new Error("Decision server error");
          const data = await response.json() as { results?: { answers?: unknown; usage?: { truncated?: boolean } }[] };
          if (!Array.isArray(data.results) || data.results.length !== batch.length) throw new Error("Incomplete decision batch");
          if (data.results.some(result => result.usage?.truncated)) throw new RequestError(503, "The policy check exceeded the decision model’s context. Shorten the question and try again.");
          answers.push(...data.results.map(result => result.answers));
        }
        return answers;
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError(503, "The local policy checks could not finish. Check that Laya has completed its startup warm-up and try again.");
      }
    }),
  };
}

export function requireModelResult<T>(schema: TSchema, result: unknown, label: string): T {
  if (!Check(schema, result)) {
    throw new RequestError(503, `The ${label} returned an invalid result. Try again.`);
  }
  return result as T;
}
