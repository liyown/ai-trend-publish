export type ConfigRuntimeTarget = "local" | "docker" | "cloudflare";

export interface ConfigRuntime {
  target: ConfigRuntimeTarget;
  value(name: string, fallback?: string): string;
  secret(name: string, fallback?: string): string;
  required(name: string): string;
}

export interface ServerConfig {
  apiKey?: string;
  port?: number;
}

export interface DatabaseConfig {
  /** 本地模块化运行态数据库。Cloudflare 部署使用 ARTICLE_DB binding。 */
  sqlitePath?: string;
}

export interface ObservabilityConfig {
  enabled?: boolean;
  serviceName?: string;
  environment?: string;
  stdout?: { enabled?: boolean; format?: "json" | "pretty" };
  http?: {
    enabled?: boolean;
    endpoint?: string;
    bearerToken?: string;
    headers?: Record<string, string>;
    format?: "object" | "array" | "ndjson";
    timeoutMs?: number;
  };
  axiom?: {
    enabled?: boolean;
    dataset?: string;
    token?: string;
    apiUrl?: string;
    timeoutMs?: number;
  };
  betterStack?: {
    enabled?: boolean;
    sourceToken?: string;
    ingestingHost?: string;
    timeoutMs?: number;
  };
}

export interface TrendPublishConfig {
  server?: ServerConfig;
  database?: DatabaseConfig;
  observability?: ObservabilityConfig;
}

export type TrendPublishConfigFactory = (
  runtime: ConfigRuntime,
) => TrendPublishConfig | Promise<TrendPublishConfig>;
export type TrendPublishConfigSource = TrendPublishConfig | TrendPublishConfigFactory;

export interface ResolvedTrendPublishConfig {
  server: { apiKey: string; port: number };
  database: { sqlitePath: string };
  observability: {
    enabled: boolean;
    serviceName: string;
    environment: string;
    stdout: { enabled: boolean; format: "json" | "pretty" };
    http: {
      enabled: boolean;
      endpoint: string;
      bearerToken: string;
      headers: Record<string, string>;
      format: "object" | "array" | "ndjson";
      timeoutMs: number;
    };
    axiom: {
      enabled: boolean;
      dataset: string;
      token: string;
      apiUrl: string;
      timeoutMs: number;
    };
    betterStack: {
      enabled: boolean;
      sourceToken: string;
      ingestingHost: string;
      timeoutMs: number;
    };
  };
}

export function defineConfig(config: TrendPublishConfig): TrendPublishConfig;
export function defineConfig(config: TrendPublishConfigFactory): TrendPublishConfigFactory;
export function defineConfig(config: TrendPublishConfigSource): TrendPublishConfigSource {
  return config;
}

export function resolveTrendPublishConfig(config: TrendPublishConfig): ResolvedTrendPublishConfig {
  return {
    server: {
      apiKey: config.server?.apiKey ?? "",
      port: config.server?.port ?? 8000,
    },
    database: {
      sqlitePath: config.database?.sqlitePath ?? "data/trendpublish.sqlite3",
    },
    observability: {
      enabled: config.observability?.enabled ?? true,
      serviceName: config.observability?.serviceName ?? "trendpublish",
      environment: config.observability?.environment ?? "local",
      stdout: {
        enabled: config.observability?.stdout?.enabled ?? false,
        format: config.observability?.stdout?.format ?? "json",
      },
      http: {
        enabled: config.observability?.http?.enabled ?? false,
        endpoint: config.observability?.http?.endpoint ?? "",
        bearerToken: config.observability?.http?.bearerToken ?? "",
        headers: config.observability?.http?.headers ?? {},
        format: config.observability?.http?.format ?? "object",
        timeoutMs: config.observability?.http?.timeoutMs ?? 5000,
      },
      axiom: {
        enabled: config.observability?.axiom?.enabled ?? false,
        dataset: config.observability?.axiom?.dataset ?? "",
        token: config.observability?.axiom?.token ?? "",
        apiUrl: config.observability?.axiom?.apiUrl ?? "https://api.axiom.co",
        timeoutMs: config.observability?.axiom?.timeoutMs ?? 5000,
      },
      betterStack: {
        enabled: config.observability?.betterStack?.enabled ?? false,
        sourceToken: config.observability?.betterStack?.sourceToken ?? "",
        ingestingHost:
          config.observability?.betterStack?.ingestingHost ?? "https://in.logs.betterstack.com",
        timeoutMs: config.observability?.betterStack?.timeoutMs ?? 5000,
      },
    },
  };
}
