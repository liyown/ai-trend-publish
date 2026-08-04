import { AsyncLocalStorage } from "node:async_hooks";

export interface LoggerContext {
  runId?: string;
  workflowId?: string;
  step?: string;
  profileId?: string;
  mode?: string;
  dryRun?: boolean;
  trigger?: string;
}

const storage = new AsyncLocalStorage<LoggerContext>();

export function getLoggerContext(): LoggerContext {
  return storage.getStore() ?? {};
}

export async function withLoggerContext<T>(
  context: LoggerContext,
  fn: () => Promise<T>,
): Promise<T> {
  const current = storage.getStore() ?? {};
  return await storage.run({ ...current, ...definedOnly(context) }, fn);
}

function definedOnly(context: LoggerContext): LoggerContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as LoggerContext;
}
