import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatDuration(ms?: number) {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatSize(size?: number) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) current = readRecord(current)[key];
  return current;
}

export function readString(value: unknown, path: string[], fallback = "") {
  const result = readPath(value, path);
  return typeof result === "string" && result.trim() ? result : fallback;
}

export function readNumber(value: unknown, path: string[], fallback = 0) {
  const result = readPath(value, path);
  return typeof result === "number" && Number.isFinite(result) ? result : fallback;
}

export function readBoolean(value: unknown, path: string[], fallback = false) {
  const result = readPath(value, path);
  return typeof result === "boolean" ? result : fallback;
}

export function clampText(value: string | undefined, fallback = "-") {
  return value && value.trim() ? value.trim() : fallback;
}
