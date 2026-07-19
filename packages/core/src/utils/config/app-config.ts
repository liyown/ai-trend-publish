import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ConfigRuntime,
  ConfigRuntimeTarget,
  ResolvedTrendPublishConfig,
  resolveTrendPublishConfig,
  TrendPublishConfigSource,
} from "./define-config.ts";
import { configureLoggerObservability } from "../../logger/configure-logger-observability.ts";
import { stringifyUnknown } from "../common.ts";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const CONFIG_FILE_NAME = "trendpublish.config.ts";
const CONFIG_PATH_ENV_NAME = "TRENDPUBLISH_CONFIG";
let cachedConfig: ResolvedTrendPublishConfig | undefined;

interface ConfigModule {
  default?: TrendPublishConfigSource;
  config?: TrendPublishConfigSource;
}

export interface InitializeAppConfigOptions {
  /** 显式配置文件路径。优先级高于 TRENDPUBLISH_CONFIG。 */
  configPath?: string;
  /** 直接传入配置源，主要用于 Cloudflare Worker。 */
  source?: TrendPublishConfigSource;
  /** 配置函数运行时上下文。 */
  runtime?: ConfigRuntime;
}

interface LoadAppConfigOptions extends InitializeAppConfigOptions {
  bustCache?: boolean;
}

export interface ParsedConfigArgs {
  configPath?: string;
  args: string[];
}

export async function initializeAppConfig(): Promise<ResolvedTrendPublishConfig>;

export async function initializeAppConfig(
  options: InitializeAppConfigOptions,
): Promise<ResolvedTrendPublishConfig>;

export async function initializeAppConfig(
  options: InitializeAppConfigOptions = {},
): Promise<ResolvedTrendPublishConfig> {
  cachedConfig = await loadAppConfig(options);
  return cachedConfig;
}

export async function getAppConfig(): Promise<ResolvedTrendPublishConfig> {
  if (!cachedConfig) {
    cachedConfig = await loadAppConfig();
  }
  return cachedConfig;
}

export async function reloadAppConfig(
  options: InitializeAppConfigOptions = {},
): Promise<ResolvedTrendPublishConfig> {
  cachedConfig = await loadAppConfig({ ...options, bustCache: true });
  return cachedConfig;
}

export async function shutdownAppResources(): Promise<void> {
  await Promise.resolve();
}

export function parseConfigArgs(args: string[]): ParsedConfigArgs {
  const remaining: string[] = [];
  let configPath: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--config") {
      const next = args[index + 1];
      if (!next) {
        throw new ConfigurationError("--config 需要提供配置文件路径");
      }
      configPath = next;
      index++;
      continue;
    }
    if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
      if (!configPath) {
        throw new ConfigurationError("--config 需要提供配置文件路径");
      }
      continue;
    }
    remaining.push(arg);
  }

  return { configPath, args: remaining };
}

export function createConfigRuntime(
  options: {
    target?: ConfigRuntimeTarget;
    values?: Record<string, unknown>;
    secretDir?: string;
  } = {},
): ConfigRuntime {
  const secretDir = options.secretDir ?? "/run/secrets";
  const target = options.target ?? detectConfigRuntimeTarget();

  const readRuntimeValue = (name: string): string | undefined => {
    const fromValues = options.values?.[name];
    if (fromValues !== undefined && fromValues !== null) {
      return stringifyUnknown(fromValues);
    }
    return readProcessValue(name);
  };

  const readSecret = (name: string): string | undefined => {
    const secretPath = resolve(secretDir, name);
    if (fileExists(secretPath)) {
      return readTextFile(secretPath)?.trim();
    }
    return readRuntimeValue(name);
  };

  return {
    target,
    value(name, fallback = "") {
      return readRuntimeValue(name) ?? fallback;
    },
    secret(name, fallback = "") {
      return readSecret(name) ?? fallback;
    },
    required(name) {
      const value = readSecret(name);
      if (!value) {
        throw new ConfigurationError(`缺少运行时配置: ${name}`);
      }
      return value;
    },
  };
}

async function loadAppConfig(
  options: LoadAppConfigOptions = {},
): Promise<ResolvedTrendPublishConfig> {
  const runtime = options.runtime ?? createConfigRuntime();
  if (options.source) {
    const config = await resolveConfigSource(options.source, runtime);
    const resolved = resolveTrendPublishConfig(config);
    configureLoggerObservability(resolved);
    return resolved;
  }

  const { configPath, explicit } = resolveConfigPath(options.configPath);
  if (!fileExists(configPath)) {
    if (explicit) {
      throw new ConfigurationError(`配置文件不存在: ${configPath}`);
    }
    return resolveTrendPublishConfig({});
  }

  const moduleUrl = pathToFileURL(configPath).href;
  const cacheSuffix = options.bustCache ? `?t=${Date.now()}` : "";
  const module = await importConfigModule(`${moduleUrl}${cacheSuffix}`, configPath);
  const config = await resolveConfigSource(module.default ?? module.config ?? {}, runtime);
  const resolved = resolveTrendPublishConfig(config);
  configureLoggerObservability(resolved);
  return resolved;
}

async function importConfigModule(moduleUrl: string, configPath: string): Promise<ConfigModule> {
  try {
    return (await import(moduleUrl)) as ConfigModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigurationError(`配置文件加载失败: ${configPath}\n${message}`);
  }
}

function resolveConfigPath(configPath?: string): {
  configPath: string;
  explicit: boolean;
} {
  if (configPath) {
    return { configPath: resolve(configPath), explicit: true };
  }
  const processConfigPath = readProcessValue(CONFIG_PATH_ENV_NAME);
  if (processConfigPath) {
    return { configPath: resolve(processConfigPath), explicit: true };
  }
  return {
    configPath: resolve(getCurrentWorkingDirectory(), CONFIG_FILE_NAME),
    explicit: false,
  };
}

async function resolveConfigSource(source: TrendPublishConfigSource, runtime: ConfigRuntime) {
  if (typeof source === "function") {
    return await source(runtime);
  }
  return source;
}

function detectConfigRuntimeTarget(): ConfigRuntimeTarget {
  if (readProcessValue("TRENDPUBLISH_RUNTIME") === "docker") {
    return "docker";
  }
  return "local";
}

function readProcessValue(name: string): string | undefined {
  return process.env[name];
}

function fileExists(path: string): boolean {
  return existsSync(path);
}

function readTextFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function getCurrentWorkingDirectory(): string {
  return process.cwd();
}
