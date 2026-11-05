import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createModels } from "./models.js";

export function loadConfig() {
  const provider = process.env.LLM_PROVIDER?.trim() || "openrouter";
  if (provider !== "openrouter" && provider !== "gemini" && provider !== "ollama") {
    throw new Error("LLM_PROVIDER must be openrouter, gemini, or ollama.");
  }
  const generator = provider === "ollama" ? {
    provider,
    ollamaUrl: process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL?.trim() || "qwen3:1.7b-q4_K_M",
  } as const : provider === "gemini" ? {
    provider,
    apiKey: process.env.GOOGLE_GEMINI_API_KEY?.trim(),
    model: process.env.GOOGLE_GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
  } as const : {
    provider,
    apiKey: process.env.OPENROUTER_API_KEY?.trim(),
    model: process.env.OPENROUTER_MODEL?.trim() || "nvidia/nemotron-3.5-super-vl:free",
  } as const;
  const dbPath = resolve(process.env.COGNIVA_DB_PATH ?? "data/cogniva.sqlite");
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  let secret = process.env.COGNIVA_SECRET;
  if (!secret) {
    const secretPath = resolve(dirname(dbPath), ".secret");
    try {
      writeFileSync(secretPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
    secret = readFileSync(secretPath, "utf8").trim();
  }
  if (secret.length < 32) throw new Error("COGNIVA_SECRET must be at least 32 characters.");
  return {
    db: new DatabaseSync(dbPath),
    origin: process.env.COGNIVA_ORIGIN ?? "http://localhost:5173",
    secret,
    models: createModels({
      ...generator,
      layaUrl: process.env.LAYA_URL ?? "http://127.0.0.1:8000",
    }),
  };
}
