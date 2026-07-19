import { sessionAuthStore } from "../storage/session-auth-store.ts";
import { DashboardApiError } from "./dashboard-errors.ts";
import type { ApiErrorPayload } from "./types.ts";

async function parseApiError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as ApiErrorPayload;
    const base = parsed.error ?? "请求失败";
    const issues = parsed.issues
      ?.map((issue) => [issue.path, issue.message].filter(Boolean).join(": "))
      .filter(Boolean);
    return issues?.length ? `${base}：${issues.join("；")}` : base;
  } catch {
    return text;
  }
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = sessionAuthStore.read();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    throw new DashboardApiError({
      message: await parseApiError(response),
      status: response.status,
      statusText: response.statusText,
      path,
    });
  }
  return (await response.json()) as T;
}

export const mutation = <T>(path: string, method: string, body?: unknown) =>
  apiJson<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
