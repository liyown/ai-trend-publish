export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export class Logger {
  static level: LogLevel = LogLevel.INFO;

  constructor(private readonly scope = "trendpublish") {}

  debug(...args: unknown[]): void {
    console.debug(`[${this.scope}]`, ...args);
  }

  info(...args: unknown[]): void {
    console.info(`[${this.scope}]`, ...args);
  }

  warn(...args: unknown[]): void {
    console.warn(`[${this.scope}]`, ...args);
  }

  error(...args: unknown[]): void {
    console.error(`[${this.scope}]`, ...args);
  }
}
