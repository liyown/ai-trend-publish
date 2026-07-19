import { getLoggerContext } from "./logger-context.ts";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  OFF = 4,
}

export enum LogLevelOperator {
  GreaterThanOrEqual = "gte",
  LessThanOrEqual = "lte",
}

export enum TimestampFormat {
  ISO = "iso",
}

export interface LoggerRecord {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  category?: string;
  message: string;
  formatted: string;
  context?: unknown;
  runId?: string;
  workflowId?: string;
  step?: string;
  profileId?: string;
  mode?: string;
  dryRun?: boolean;
  trigger?: string;
}

export type LoggerObserver = (record: LoggerRecord) => void | Promise<void>;

const observers = new Set<LoggerObserver>();

export function addLoggerObserver(observer: LoggerObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function clearLoggerObservers(): void {
  observers.clear();
}

export class Logger {
  static level = LogLevel.INFO;
  static levelOperator = LogLevelOperator.GreaterThanOrEqual;
  static alignmentCategories: string[] | undefined;

  constructor(private readonly category?: string) {}

  debug(message: string, context?: unknown) {
    return this.log(message, LogLevel.DEBUG, false, context);
  }

  info(message: string, context?: unknown) {
    return this.log(message, LogLevel.INFO, false, context);
  }

  warn(message: string, context?: unknown) {
    return this.log(message, LogLevel.WARN, false, context);
  }

  error(message: string, context?: unknown) {
    return this.log(message, LogLevel.ERROR, false, context);
  }

  log(message: string, level: LogLevel, throws?: boolean, context?: unknown) {
    const timestamp = new Date().toISOString();
    const levelName = getLogLevelName(level);
    const formatted = `[${levelName}] ${timestamp}${
      this.category ? ` [${this.category}]` : ""
    } :: ${message}`;

    if (canLog(level)) {
      const activeContext = getLoggerContext();
      const explicitContext = readRecordContext(context);
      notifyObservers({
        timestamp,
        level,
        levelName,
        category: this.category,
        message,
        formatted,
        context,
        runId: explicitContext.runId ?? activeContext.runId,
        workflowId: explicitContext.workflowId ?? activeContext.workflowId,
        step: explicitContext.step ?? activeContext.step,
        profileId: explicitContext.profileId ?? activeContext.profileId,
        mode: explicitContext.mode ?? activeContext.mode,
        dryRun: explicitContext.dryRun ?? activeContext.dryRun,
        trigger: explicitContext.trigger ?? activeContext.trigger,
      });
      writeConsole(level, formatted, context);
    }

    if (throws) throw new Error(message);
    return formatted;
  }
}

function readRecordContext(context: unknown): Partial<LoggerRecord> {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }
  const record = context as Record<string, unknown>;
  return {
    runId: stringValue(record.runId),
    workflowId: stringValue(record.workflowId),
    step: stringValue(record.step),
    profileId: stringValue(record.profileId),
    mode: stringValue(record.mode),
    dryRun: booleanValue(record.dryRun),
    trigger: stringValue(record.trigger),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function canLog(level: LogLevel): boolean {
  if (Logger.level === LogLevel.OFF) return false;
  if (Logger.levelOperator === LogLevelOperator.LessThanOrEqual) {
    return level <= Logger.level;
  }
  return level >= Logger.level;
}

function getLogLevelName(level: LogLevel): string {
  return LogLevel[level] ?? String(level);
}

function writeConsole(level: LogLevel, formatted: string, context?: unknown) {
  const args = context === undefined ? [formatted] : [formatted, context];
  if (level >= LogLevel.ERROR) {
    console.error(...args);
  } else if (level >= LogLevel.WARN) {
    console.warn(...args);
  } else {
    console.log(...args);
  }
}

function notifyObservers(record: LoggerRecord): void {
  for (const observer of observers) {
    queueMicrotask(async () => {
      try {
        await observer(record);
      } catch {
        // Observability must never break normal logging or business flow.
      }
    });
  }
}
