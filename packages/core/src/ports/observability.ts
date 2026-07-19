export type ObservabilityLevel = "debug" | "info" | "warn" | "error";

export type ObservabilityEventKind =
  | "log"
  | "workflow"
  | "step"
  | "provider"
  | "artifact"
  | "publish"
  | "notification";

export interface ObservabilityEvent {
  timestamp: string;
  level: ObservabilityLevel;
  kind: ObservabilityEventKind;
  event: string;
  service: string;
  environment: string;
  runId?: string;
  profileId?: string;
  mode?: string;
  dryRun?: boolean;
  trigger?: string;
  step?: string;
  provider?: string;
  model?: string;
  attempt?: number;
  durationMs?: number;
  artifactKeys?: string[];
  message?: string;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  attributes?: Record<string, unknown>;
}

export interface ObservabilitySink {
  emit(event: ObservabilityEvent): Promise<void>;
  flush?(): Promise<void>;
}

export interface ObservabilityLogger {
  event(event: Omit<ObservabilityEvent, "timestamp" | "service" | "environment">): Promise<void>;
  flush(): Promise<void>;
}

export class NoopObservabilityLogger implements ObservabilityLogger {
  async event(): Promise<void> {}
  async flush(): Promise<void> {}
}
