import type { ConnectorCapability } from "./types.ts";

export const ConnectorOutcome = {
  Known: "known",
  Unknown: "unknown",
} as const;
export type ConnectorOutcome = (typeof ConnectorOutcome)[keyof typeof ConnectorOutcome];

export type ConnectorErrorKind =
  | "configuration"
  | "authentication"
  | "permission"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "network"
  | "invalid_request"
  | "invalid_response"
  | "provider";

export interface ConnectorErrorOptions {
  message: string;
  kind: ConnectorErrorKind;
  connectorId?: string;
  connectionId?: string;
  capability?: ConnectorCapability;
  operation?: string;
  retryable?: boolean;
  statusCode?: number;
  providerCode?: string;
  requestId?: string;
  outcome?: ConnectorOutcome;
  cause?: unknown;
}

export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly connectorId?: string;
  readonly connectionId?: string;
  readonly capability?: ConnectorCapability;
  readonly operation?: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly providerCode?: string;
  readonly requestId?: string;
  readonly outcome: ConnectorOutcome;
  override readonly cause?: unknown;

  constructor(options: ConnectorErrorOptions) {
    super(options.message);
    this.name = "ConnectorError";
    this.kind = options.kind;
    this.connectorId = options.connectorId;
    this.connectionId = options.connectionId;
    this.capability = options.capability;
    this.operation = options.operation;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
    this.providerCode = options.providerCode;
    this.requestId = options.requestId;
    this.outcome = options.outcome ?? ConnectorOutcome.Known;
    this.cause = options.cause;
  }

  withContext(context: Partial<ConnectorErrorOptions>): ConnectorError {
    return new ConnectorError({
      message: context.message ?? this.message,
      kind: this.kind,
      connectorId: context.connectorId ?? this.connectorId,
      connectionId: context.connectionId ?? this.connectionId,
      capability: context.capability ?? this.capability,
      operation: context.operation ?? this.operation,
      retryable: context.retryable ?? this.retryable,
      statusCode: context.statusCode ?? this.statusCode,
      providerCode: context.providerCode ?? this.providerCode,
      requestId: context.requestId ?? this.requestId,
      outcome: context.outcome ?? this.outcome,
      cause: context.cause ?? this.cause,
    });
  }
}

export function connectorErrorFromStatus(status: number, message: string): ConnectorError {
  if (status === 401)
    return new ConnectorError({ kind: "authentication", message, statusCode: status });
  if (status === 403)
    return new ConnectorError({ kind: "permission", message, statusCode: status });
  if (status === 402) return new ConnectorError({ kind: "quota", message, statusCode: status });
  if (status === 429) {
    return new ConnectorError({ kind: "rate_limit", message, statusCode: status, retryable: true });
  }
  return new ConnectorError({
    kind: status >= 500 ? "provider" : "invalid_request",
    message,
    statusCode: status,
    retryable: status >= 500,
    outcome: status >= 500 ? ConnectorOutcome.Unknown : ConnectorOutcome.Known,
  });
}

export function describeConnectorError(value: unknown): string {
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
    return JSON.stringify(value) ?? "[unknown]";
  } catch {
    return Object.prototype.toString.call(value);
  }
}
