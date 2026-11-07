import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import type { DocumentInfo, Usage } from "../../shared/contracts.js";

export const auth = createAuthClient({ plugins: [organizationClient()] });

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error ?? "Request failed. Try again.", body.code);
  return body as T;
}

export interface DashboardData {
  organization: { id: string; name: string };
  documents: DocumentInfo[];
  usage: Usage;
  token: string | null;
  assistantNeedsRegeneration: boolean;
}
