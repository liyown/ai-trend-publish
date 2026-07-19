export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "[unknown]";
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function normalize(value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { $number: String(value) };
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  throw new TypeError(`不能为 ${typeof value} 创建稳定指纹`);
}
