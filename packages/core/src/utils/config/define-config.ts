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

const DEFAULT_HTTP: ResolvedTrendPublishConfig["observability"]["http"] = {
  enabled: false,
  endpoint: "",
  bearerToken: "",
  headers: {},
  format: "object",
  timeoutMs: 5000,
};

const DEFAULT_AXIOM: ResolvedTrendPublishConfig["observability"]["axiom"] = {
  enabled: false,
  dataset: "",
  token: "",
  apiUrl: "https://api.axiom.co",
  timeoutMs: 5000,
};

const DEFAULT_BETTERSTACK: ResolvedTrendPublishConfig["observability"]["betterStack"] = {
  enabled: false,
  sourceToken: "",
  ingestingHost: "https://in.logs.betterstack.com",
  timeoutMs: 5000,
};

export function resolveTrendPublishConfig(config: TrendPublishConfig): ResolvedTrendPublishConfig {
  const obs = config.observability ?? {};
  return {
    server: { apiKey: config.server?.apiKey ?? "", port: config.server?.port ?? 8000 },
    database: { sqlitePath: config.database?.sqlitePath ?? "data/trendpublish.sqlite3" },
    observability: {
      enabled: obs.enabled ?? true,
      serviceName: obs.serviceName ?? "trendpublish",
      environment: obs.environment ?? "local",
      stdout: { enabled: obs.stdout?.enabled ?? false, format: obs.stdout?.format ?? "json" },
      http: { ...DEFAULT_HTTP, ...obs.http },
      axiom: { ...DEFAULT_AXIOM, ...obs.axiom },
      betterStack: { ...DEFAULT_BETTERSTACK, ...obs.betterStack },
    },
  };
}
