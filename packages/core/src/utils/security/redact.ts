const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/((?:access_token|api_key|apikey|apiKey|secret|token|password)=)[^&\s"']+/gi, "$1[REDACTED]"],
  [/(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, "$1[REDACTED]"],
  [/("(?:access_token|apiKey|api_key|secret|token|password)"\s*:\s*")[^"]+(")/gi, "$1[REDACTED]$2"],
];

export function redactSensitiveText(value: unknown): string {
  const text = typeof value === "string" ? value : stringifyForRedaction(value);
  return REDACTION_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

export function redactError(error: unknown): Error {
  if (error instanceof Error) {
    const redacted = new Error(redactSensitiveText(error.message));
    redacted.name = error.name;
    redacted.stack = error.stack ? redactSensitiveText(error.stack) : undefined;
    return redacted;
  }
  return new Error(redactSensitiveText(error));
}

function stringifyForRedaction(value: unknown): string {
  return stringifyUnknown(value);
}
import { stringifyUnknown } from "../common.ts";
