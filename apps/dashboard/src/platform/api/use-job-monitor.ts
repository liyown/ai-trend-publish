import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { JobStatus, type JobStatus as JobStatusValue } from "@trendpublish/contracts";
import type { RuntimeEvent } from "./types.ts";
import { dashboardErrorMessage, isPermanentEventStreamError } from "./dashboard-errors.ts";
import { useAuth } from "../../app/auth.tsx";
import { useDashboardApi } from "../../app/providers.tsx";
import { dashboardQueryKeys } from "#platform/api/query-keys.ts";

export const ACTIVE_JOB_REFRESH_MS = 2000;
const EVENT_STREAM_RETRY_BASE_MS = 1000;
const EVENT_STREAM_RETRY_MAX_MS = 15_000;
const MAX_RUNTIME_EVENTS = 200;

export type JobEventStreamState = "idle" | "connecting" | "live" | "retrying" | "unavailable";

export interface RuntimeEventBufferState {
  jobId: string | null;
  events: RuntimeEvent[];
}

export interface JobMonitorOptions {
  live?: boolean;
}

export function useJobMonitor(jobId: string | null, { live = true }: JobMonitorOptions = {}) {
  const { apiKey } = useAuth();
  const api = useDashboardApi();
  const queryClient = useQueryClient();
  const generation = useRef(0);
  const [eventState, setEventState] = useState<RuntimeEventBufferState>({
    jobId: null,
    events: [],
  });
  const [stream, setStream] = useState<{
    jobId: string | null;
    state: JobEventStreamState;
    error?: string;
  }>({ jobId: null, state: "idle" });
  const query = useQuery({
    queryKey: dashboardQueryKeys(apiKey).job(jobId),
    queryFn: () => api.getJob(apiKey, jobId ?? ""),
    enabled: Boolean(apiKey && jobId),
    refetchInterval: (currentQuery) => {
      if (!live || !jobId) return false;
      return isActiveJobStatus(currentQuery.state.data?.job.status) ? ACTIVE_JOB_REFRESH_MS : false;
    },
  });
  const streamPolicy = jobEventStreamPolicy(query.data?.job.status, live);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let lastEventId: string | undefined;
    let retryAttempt = 0;
    let terminalEventReceived = false;
    const isCurrent = () => !stopped && generation.current === currentGeneration;

    setEventState((current) => (current.jobId === jobId ? current : { jobId, events: [] }));
    setStream({ jobId, state: streamPolicy.connect ? "connecting" : "idle" });
    if (!streamPolicy.connect || !apiKey || !jobId) {
      return () => {
        stopped = true;
      };
    }

    const controller = new AbortController();
    const scheduleRetry = () => {
      if (!isCurrent()) return;
      setStream({ jobId, state: "retrying" });
      const delay = eventStreamRetryDelay(retryAttempt++);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (!isCurrent()) return;
      setStream({
        jobId,
        state: lastEventId || retryAttempt ? "retrying" : "connecting",
      });
      try {
        await api.streamJobEvents(apiKey, jobId, {
          signal: controller.signal,
          lastEventId,
          onOpen() {
            if (isCurrent()) setStream({ jobId, state: "live" });
          },
          onEvent(event) {
            if (!isCurrent()) return;
            lastEventId = event.id;
            retryAttempt = 0;
            if (isTerminalRuntimeJobEvent(event)) {
              terminalEventReceived = true;
              setStream({ jobId, state: "idle" });
            }
            setEventState((current) => mergeJobRuntimeEvent(current, jobId, event));
            if (event.type.startsWith("task.") || event.type.startsWith("job.")) {
              void queryClient.invalidateQueries({
                queryKey: dashboardQueryKeys(apiKey).job(jobId),
              });
            }
            if (event.type === "job.status.changed") {
              void queryClient.invalidateQueries({
                queryKey: dashboardQueryKeys(apiKey).snapshot,
              });
            }
          },
        });
        if (!terminalEventReceived && streamPolicy.retry) {
          scheduleRetry();
        } else if (isCurrent()) {
          setStream({ jobId, state: "idle" });
        }
      } catch (error) {
        if (!isCurrent() || controller.signal.aborted) return;
        if (terminalEventReceived) {
          setStream({ jobId, state: "idle" });
          return;
        }
        if (isPermanentEventStreamError(error) || !streamPolicy.retry) {
          setStream({
            jobId,
            state: "unavailable",
            error: dashboardErrorMessage(error),
          });
          return;
        }
        scheduleRetry();
      }
    };
    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [api, apiKey, jobId, queryClient, streamPolicy.connect, streamPolicy.retry]);

  return {
    ...query,
    runtimeEvents: eventState.jobId === jobId ? eventState.events : [],
    streamState: stream.jobId === jobId ? stream.state : "idle",
    streamError: stream.jobId === jobId ? stream.error : undefined,
  };
}

export function isActiveJobStatus(status: JobStatusValue | undefined): boolean {
  return status === JobStatus.Queued || status === JobStatus.Running;
}

export function jobEventStreamPolicy(
  status: JobStatusValue | undefined,
  live: boolean,
): { connect: boolean; retry: boolean } {
  const retry = live && isActiveJobStatus(status);
  return {
    connect: live && status !== undefined,
    retry,
  };
}

export function eventStreamRetryDelay(attempt: number): number {
  return Math.min(
    EVENT_STREAM_RETRY_BASE_MS * 2 ** Math.max(0, attempt),
    EVENT_STREAM_RETRY_MAX_MS,
  );
}

export function appendRuntimeEvent(current: RuntimeEvent[], event: RuntimeEvent): RuntimeEvent[] {
  const duplicateIndex = current.findIndex((item) => item.id === event.id);
  if (duplicateIndex !== -1 && !sameRuntimeEvent(current[duplicateIndex]!, event)) {
    // Runtime event IDs are process-local. A local server restart begins a new sequence, so an
    // ID collision with different immutable event metadata marks a new replay epoch.
    return [event];
  }
  const next =
    duplicateIndex === -1 ? [...current, event] : current.toSpliced(duplicateIndex, 1, event);
  return next.slice(-MAX_RUNTIME_EVENTS);
}

function sameRuntimeEvent(left: RuntimeEvent, right: RuntimeEvent): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.occurredAt === right.occurredAt &&
    left.jobId === right.jobId &&
    left.taskId === right.taskId
  );
}

export function mergeJobRuntimeEvent(
  current: RuntimeEventBufferState,
  jobId: string,
  event: RuntimeEvent,
): RuntimeEventBufferState {
  if (current.jobId !== jobId || (event.jobId && event.jobId !== jobId)) return current;
  return { jobId, events: appendRuntimeEvent(current.events, event) };
}

export function isTerminalRuntimeJobEvent(event: RuntimeEvent): boolean {
  if (event.type !== "job.status.changed" || !event.data || typeof event.data !== "object") {
    return false;
  }
  const data = event.data as { sourceJobId?: unknown; status?: unknown };
  if (typeof data.sourceJobId === "string" && data.sourceJobId) return false;
  const status = data.status;
  return (
    status === JobStatus.Succeeded ||
    status === JobStatus.Degraded ||
    status === JobStatus.Failed ||
    status === JobStatus.NeedsAttention
  );
}
