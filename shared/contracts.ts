export const LIMITS = { documents: 10, pages: 20, bytes: 10_000_000, question: 1_200 };

export interface AssistantInfo {
  organizationName: string;
}

export interface Usage {
  asked: number;
  answered: number;
  no_answer: number;
  needs_clarification: number;
  unresolved: number;
  failed: number;
}

export interface DocumentInfo {
  id: string;
  name: string;
  size: number;
  pages: number | null;
  status: "processing" | "ready" | "failed";
  error: string | null;
  replaces: string | null;
  createdAt: string;
}

export interface Reference {
  id: string;
  name: string;
  page: number;
  quote: string;
}

export interface DecisionCheck {
  label: string;
  method: "Choice" | "Boolean (Noul)" | "Rule";
  result: string;
  score?: number;
}

export interface Answer {
  status: "answered" | "no_answer" | "needs_clarification" | "unresolved" | "acknowledged";
  text: string;
  references: Reference[];
  decision?: { verdict: "Conditions met" | "Conditions not met" | "Uncertain"; checks: DecisionCheck[] };
}
