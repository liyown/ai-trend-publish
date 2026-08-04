import { expect, test } from "vite-plus/test";
import { JobStatus } from "@trendpublish/contracts";
import type { RuntimeEvent } from "./types.ts";
import {
  appendRuntimeEvent,
  eventStreamRetryDelay,
  isActiveJobStatus,
  isTerminalRuntimeJobEvent,
  jobEventStreamPolicy,
  mergeJobRuntimeEvent,
} from "./use-job-monitor.ts";

test("only queued and running jobs keep live refresh active", () => {
  expect(isActiveJobStatus(JobStatus.Queued)).toBe(true);
  expect(isActiveJobStatus(JobStatus.Running)).toBe(true);
  expect(isActiveJobStatus(JobStatus.Succeeded)).toBe(false);
  expect(isActiveJobStatus(JobStatus.Degraded)).toBe(false);
  expect(isActiveJobStatus(JobStatus.Failed)).toBe(false);
  expect(isActiveJobStatus(JobStatus.NeedsAttention)).toBe(false);
  expect(isActiveJobStatus(undefined)).toBe(false);
});

test("event stream retries exponentially with a bounded delay", () => {
  expect([0, 1, 2, 3, 4, 8].map(eventStreamRetryDelay)).toEqual([
    1000, 2000, 4000, 8000, 15_000, 15_000,
  ]);
});

test("loaded terminal jobs replay events once while only active jobs retry", () => {
  expect(jobEventStreamPolicy(undefined, true)).toEqual({ connect: false, retry: false });
  expect(jobEventStreamPolicy(JobStatus.Succeeded, true)).toEqual({
    connect: true,
    retry: false,
  });
  expect(jobEventStreamPolicy(JobStatus.Failed, true)).toEqual({
    connect: true,
    retry: false,
  });
  expect(jobEventStreamPolicy(JobStatus.Running, true)).toEqual({
    connect: true,
    retry: true,
  });
  expect(jobEventStreamPolicy(JobStatus.Running, false)).toEqual({
    connect: false,
    retry: false,
  });
});

test("runtime event merge replaces replayed IDs and bounds retained events", () => {
  const events = Array.from({ length: 205 }, (_, index) => runtimeEvent(String(index)));
  const bounded = events.reduce<RuntimeEvent[]>(appendRuntimeEvent, []);
  expect(bounded).toHaveLength(200);
  expect(bounded[0]?.id).toBe("5");

  const replacement = { ...runtimeEvent("204"), data: { replayed: true } };
  const merged = appendRuntimeEvent(bounded, replacement);
  expect(merged).toHaveLength(200);
  expect(merged.at(-1)?.data).toEqual({ replayed: true });
});

test("runtime event ID reuse after a server restart starts a fresh buffer", () => {
  const previous = [runtimeEvent("1"), runtimeEvent("2")];
  const restarted = {
    ...runtimeEvent("1"),
    type: "job.status.changed",
    occurredAt: "2026-07-18T12:05:00.000Z",
  };
  expect(appendRuntimeEvent(previous, restarted)).toEqual([restarted]);
});

test("events from an obsolete or mismatched job cannot replace the active buffer", () => {
  const current = { jobId: "job-new", events: [runtimeEvent("1")] };
  expect(mergeJobRuntimeEvent(current, "job-old", runtimeEvent("2"))).toBe(current);
  expect(
    mergeJobRuntimeEvent(current, "job-new", {
      ...runtimeEvent("2"),
      jobId: "job-old",
    }),
  ).toBe(current);
  const merged = mergeJobRuntimeEvent(current, "job-new", {
    ...runtimeEvent("2"),
    jobId: "job-new",
  });
  expect(merged.events).toHaveLength(2);
});

test("terminal job events close the live stream without waiting for a snapshot", () => {
  expect(
    isTerminalRuntimeJobEvent({
      ...runtimeEvent("3"),
      type: "job.status.changed",
      data: { status: JobStatus.Succeeded },
    }),
  ).toBe(true);
  expect(
    isTerminalRuntimeJobEvent({
      ...runtimeEvent("4"),
      type: "job.status.changed",
      data: { status: JobStatus.Running },
    }),
  ).toBe(false);
  expect(
    isTerminalRuntimeJobEvent({
      ...runtimeEvent("5"),
      type: "job.status.changed",
      data: {
        sourceJobId: "article-child",
        sourceJobType: "article.generate",
        status: JobStatus.Succeeded,
      },
    }),
  ).toBe(false);
});

function runtimeEvent(id: string): RuntimeEvent {
  return {
    id,
    type: "task.started",
    occurredAt: "2026-07-18T12:00:00.000Z",
  };
}
