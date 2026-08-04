import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RunStatus, type ModelStreamEvent, type RunActivity } from "./types.ts";
import { getRun, listRunActivities, streamRunActivities, streamRunModelOutput } from "./runs.ts";

const ACTIVE_REFRESH_MS = 2_000;

export function useRunMonitor(runId: string | null) {
  const queryClient = useQueryClient();
  const [liveActivities, setLiveActivities] = useState<RunActivity[]>([]);
  const [modelEvents, setModelEvents] = useState<ModelStreamEvent[]>(() =>
    runId ? transientModelStreams.read(runId) : [],
  );
  const [activityStreamState, setActivityStreamState] = useState("idle");
  const [modelStreamState, setModelStreamState] = useState("idle");
  const [modelStreamInterrupted, setModelStreamInterrupted] = useState(false);
  const activityGeneration = useRef(0);
  const modelGeneration = useRef(0);
  const detail = useQuery({
    queryKey: ["runs", runId],
    queryFn: () => getRun(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: (query) =>
      isActive(query.state.data?.run.status) ? ACTIVE_REFRESH_MS : false,
  });
  const history = useQuery({
    queryKey: ["runs", runId, "activities"],
    queryFn: () => listRunActivities(runId ?? ""),
    enabled: Boolean(runId),
    refetchInterval: activityStreamState === "unavailable" ? ACTIVE_REFRESH_MS : false,
  });
  const activities = useMemo(
    () => mergeActivities(history.data?.activities ?? [], liveActivities),
    [history.data?.activities, liveActivities],
  );

  useEffect(() => {
    setLiveActivities([]);
    setModelEvents(runId ? transientModelStreams.read(runId) : []);
    setModelStreamInterrupted(false);
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    const generation = ++activityGeneration.current;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let lastSequence = activities.at(-1)?.sequence ?? 0;
    const current = () => generation === activityGeneration.current && !controller.signal.aborted;
    const connect = async () => {
      if (!current()) return;
      setActivityStreamState(attempt ? "retrying" : "connecting");
      try {
        await streamRunActivities(runId, {
          signal: controller.signal,
          afterSequence: lastSequence,
          lastEventId: lastSequence ? String(lastSequence) : undefined,
          onOpen: () => current() && setActivityStreamState("live"),
          onEvent: (activity) => {
            if (!current()) return;
            lastSequence = Math.max(lastSequence, activity.sequence);
            setLiveActivities((items) => mergeActivities(items, [activity]));
            void queryClient.invalidateQueries({ queryKey: ["runs", runId] });
          },
        });
      } catch {
        if (!current()) return;
        attempt += 1;
        setActivityStreamState(attempt >= 5 ? "unavailable" : "retrying");
        retry = setTimeout(() => void connect(), Math.min(1_000 * 2 ** attempt, 15_000));
      }
    };
    void connect();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, [queryClient, runId]);

  useEffect(() => {
    if (!runId || !isActive(detail.data?.run.status)) return;
    if (transientModelStreams.read(runId).length) setModelStreamInterrupted(true);
    const generation = ++modelGeneration.current;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const current = () => generation === modelGeneration.current && !controller.signal.aborted;
    const connect = async () => {
      if (!current()) return;
      setModelStreamState(attempt ? "retrying" : "connecting");
      try {
        await streamRunModelOutput(runId, {
          signal: controller.signal,
          onOpen: () => current() && setModelStreamState("live"),
          onEvent: (event) => {
            if (!current()) return;
            setModelEvents(transientModelStreams.remember(runId, event));
          },
        });
      } catch {
        if (!current()) return;
        setModelStreamInterrupted(true);
        attempt += 1;
        setModelStreamState("retrying");
        retry = setTimeout(() => void connect(), Math.min(1_000 * 2 ** attempt, 15_000));
      }
    };
    void connect();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, [detail.data?.run.status, runId]);

  return {
    ...detail,
    activities,
    modelEvents,
    activityStreamState,
    modelStreamState,
    modelStreamInterrupted,
  };
}

function isActive(status: RunStatus | undefined): boolean {
  return status === RunStatus.Queued || status === RunStatus.Running;
}

export function mergeActivities(left: RunActivity[], right: RunActivity[]): RunActivity[] {
  const values = new Map(left.map((item) => [item.id, item]));
  right.forEach((item) => {
    const existing = values.get(item.id);
    if (!existing || item.sequence >= existing.sequence) values.set(item.id, item);
  });
  return [...values.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Page-memory-only cache. It is lost on refresh and never written to storage. */
export class ModelStreamMemory {
  private readonly streams = new Map<string, ModelStreamEvent[]>();

  constructor(
    private readonly maxRuns = 20,
    private readonly maxEventsPerRun = 1_000,
  ) {}

  read(runId: string): ModelStreamEvent[] {
    return [...(this.streams.get(runId) ?? [])];
  }

  remember(runId: string, event: ModelStreamEvent): ModelStreamEvent[] {
    const events = [...(this.streams.get(runId) ?? []), event].slice(-this.maxEventsPerRun);
    this.streams.delete(runId);
    this.streams.set(runId, events);
    while (this.streams.size > this.maxRuns) {
      const oldest = this.streams.keys().next().value;
      if (typeof oldest !== "string") break;
      this.streams.delete(oldest);
    }
    return [...events];
  }
}

const transientModelStreams = new ModelStreamMemory();
