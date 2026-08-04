import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type TrendPublishConfig,
  type ResolvedTrendPublishConfig,
  resolveTrendPublishConfig,
} from "./define-config.ts";
import { configureLoggerObservability } from "../../logger/configure-logger-observability.ts";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

let cachedConfig: ResolvedTrendPublishConfig | undefined;

export interface InitializeAppConfigOptions {
  /** .env 文件路径；传 false 跳过加载；默认读取 process.cwd()/.env。 */
  envFile?: string | false;
}

export function initializeAppConfig(
  options: InitializeAppConfigOptions = {},
): ResolvedTrendPublishConfig {
  cachedConfig = load(options);
  return cachedConfig;
}

export function getAppConfig(): ResolvedTrendPublishConfig {
  return (cachedConfig ??= load());
}

function boolEnv(name: string): boolean | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v === "true";
}

function readEnvConfig(): TrendPublishConfig {
  return {
    server: {
      apiKey: process.env.TRENDPUBLISH_API_KEY,
      port: Number(process.env.TRENDPUBLISH_PORT) || undefined,
    },
    database: {
      sqlitePath: process.env.TRENDPUBLISH_SQLITE_PATH || undefined,
    },
    observability: {
      enabled: boolEnv("OTEL_ENABLED"),
      serviceName: process.env.OTEL_SERVICE_NAME || undefined,
      environment: process.env.TRENDPUBLISH_ENV || undefined,
      stdout: {
        enabled: boolEnv("OTEL_STDOUT_ENABLED"),
        format: (process.env.OTEL_STDOUT_FORMAT as "json" | "pretty") || undefined,
      },
      http: {
        enabled: process.env.OTEL_HTTP_ENDPOINT ? true : undefined,
        endpoint: process.env.OTEL_HTTP_ENDPOINT || undefined,
        bearerToken: process.env.OTEL_HTTP_TOKEN || undefined,
      },
      axiom: {
        enabled: process.env.AXIOM_TOKEN ? true : undefined,
        dataset: process.env.AXIOM_DATASET || undefined,
        token: process.env.AXIOM_TOKEN || undefined,
      },
      betterStack: {
        enabled: process.env.BETTERSTACK_SOURCE_TOKEN ? true : undefined,
        sourceToken: process.env.BETTERSTACK_SOURCE_TOKEN || undefined,
      },
    },
  };
}

function load(options: InitializeAppConfigOptions = {}): ResolvedTrendPublishConfig {
  if (options.envFile !== false) {
    const envPath = options.envFile ? resolve(options.envFile) : resolve(process.cwd(), ".env");
    if (existsSync(envPath)) process.loadEnvFile(envPath);
  }
  const resolved = resolveTrendPublishConfig(readEnvConfig());
  configureLoggerObservability(resolved);
  return resolved;
}
