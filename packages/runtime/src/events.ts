export interface RuntimeEvent<T = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  jobId?: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
  data?: T;
}

export interface RuntimeEventDraft<T = unknown> {
  type: string;
  jobId?: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
  data?: T;
}

export interface RuntimeEventFilter {
  jobId?: string;
  runId?: string;
  sessionId?: string;
  afterId?: string;
}

export type RuntimeEventListener = (event: RuntimeEvent) => void;

export interface RuntimeEventPublisher {
  publish<T = unknown>(event: RuntimeEventDraft<T>): RuntimeEvent<T>;
}

export interface RuntimeEventSource extends RuntimeEventPublisher {
  recent(filter?: RuntimeEventFilter): RuntimeEvent[];
  subscribe(listener: RuntimeEventListener, filter?: RuntimeEventFilter): () => void;
}

/**
 * Process-local event stream with bounded replay. Durable job/task stores remain the source of truth;
 * this stream only carries live activity and short disconnect recovery.
 */
export class RuntimeEventHub implements RuntimeEventSource {
  private readonly events: RuntimeEvent[] = [];
  private readonly listeners = new Set<{
    listener: RuntimeEventListener;
    filter?: RuntimeEventFilter;
  }>();
  private sequence = 0;

  constructor(
    private readonly options: {
      capacity?: number;
      now?: () => Date;
      idFactory?: (sequence: number) => string;
      onListenerError?: (error: unknown) => void;
    } = {},
  ) {}

  publish<T = unknown>(draft: RuntimeEventDraft<T>): RuntimeEvent<T> {
    const sequence = ++this.sequence;
    const event: RuntimeEvent<T> = {
      id: this.options.idFactory?.(sequence) ?? String(sequence),
      type: draft.type,
      occurredAt: (this.options.now ?? (() => new Date()))().toISOString(),
      ...(draft.jobId ? { jobId: draft.jobId } : {}),
      ...(draft.taskId ? { taskId: draft.taskId } : {}),
      ...(draft.runId ? { runId: draft.runId } : {}),
      ...(draft.sessionId ? { sessionId: draft.sessionId } : {}),
      ...(draft.data === undefined ? {} : { data: structuredClone(draft.data) }),
    };
    this.events.push(event);
    const capacity = Math.max(1, this.options.capacity ?? 1_000);
    if (this.events.length > capacity) this.events.splice(0, this.events.length - capacity);
    for (const subscription of this.listeners) {
      if (!matches(event, subscription.filter)) continue;
      try {
        subscription.listener(structuredClone(event));
      } catch (error) {
        this.options.onListenerError?.(error);
      }
    }
    return structuredClone(event);
  }

  recent(filter?: RuntimeEventFilter): RuntimeEvent[] {
    return this.events
      .filter((event) => matches(event, filter))
      .map((event) => structuredClone(event));
  }

  subscribe(listener: RuntimeEventListener, filter?: RuntimeEventFilter): () => void {
    const subscription = { listener, filter };
    this.listeners.add(subscription);
    return () => this.listeners.delete(subscription);
  }
}

function matches(event: RuntimeEvent, filter?: RuntimeEventFilter): boolean {
  if (filter?.jobId && event.jobId !== filter.jobId) return false;
  if (filter?.runId && event.runId !== filter.runId) return false;
  if (filter?.sessionId && event.sessionId !== filter.sessionId) return false;
  if (filter?.afterId && compareEventIds(event.id, filter.afterId) <= 0) return false;
  return true;
}

function compareEventIds(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isSafeInteger(leftNumber) && Number.isSafeInteger(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}
