import { TaskStatus } from "@trendpublish/contracts";
import type { RuntimeEvent, TaskRecord } from "#platform/api/types.ts";

/** Known step kinds keyed by the meaningful segment of a taskId, mapped to a Chinese label. */
const STEP_KIND_LABELS: Record<string, string> = {
  research: "研究汇总",
  "plan-queries": "规划检索词",
  search: "联网搜索",
  fetch: "网页抓取",
  compose: "撰写正文",
  transform: "内容加工",
  quality: "质量总控",
  evaluate: "质量评估",
  supplement: "补充证据",
  revise: "定向修订",
  report: "质量报告",
  "review-request": "人工复核",
  build: "编译打包",
  compiler: "文档编译",
  package: "打包冻结",
  asset: "生成素材",
};

/**
 * Derives a short, human-readable label for a pipeline step from its taskId path.
 *
 * taskIds are `/`-joined scope paths such as `research/internal/plan-queries`,
 * `research/internal/fetch/2-2-1-source-fetch:connection-<uuid>` or `quality/revise/1`. The first
 * segment is the stage (already shown as the stage header) and `internal` segments are scope
 * boundaries, so both are dropped. The remaining tail carries a leading `<n>-` index and a trailing
 * `:connection-<uuid>` we strip for readability, leaving a stable kind (`fetch`, `search`, `revise`)
 * that we map to a Chinese label. A round/index number, when present, is appended as `· 第N项`.
 */
export function stepLabel(taskId: string): string {
  const segments = taskId.split("/").filter((segment) => segment && segment !== "internal");
  const tail = segments.slice(1);
  const parts = tail.length ? tail : segments;
  const kind = parts[0] ?? taskId;
  const label = STEP_KIND_LABELS[kind] ?? kind;
  const ordinal = stepOrdinal(parts);
  return ordinal ? `${label} · 第${ordinal}项` : label;
}

/** Extracts a 1-based ordinal from a step's path parts, e.g. `revise/1` or `fetch/2-3-1-…` → "1"/"2". */
function stepOrdinal(parts: string[]): string | undefined {
  for (let index = 1; index < parts.length; index += 1) {
    const leading = /^(\d+)/.exec(parts[index] ?? "");
    if (leading) return leading[1];
  }
  return undefined;
}

/**
 * Orders steps for display: chronologically by start time, but a stage's container task (the
 * shallowest taskId, e.g. the `research` wrapper) is pinned to the bottom. The container starts
 * before its children but conceptually summarizes them, so showing it last reads as "the steps,
 * then their rollup". The SQLite store lists tasks by `updated_at`, so we always re-sort on
 * `startedAt`; the taskId is a stable lexical tie-break.
 */
export function sortStepsByStart(tasks: TaskRecord[]): TaskRecord[] {
  if (!tasks.length) return [];
  const minDepth = Math.min(...tasks.map((task) => task.taskId.split("/").length));
  const depth = (task: TaskRecord) => task.taskId.split("/").length;
  return [...tasks].sort((left, right) => {
    const leftContainer = depth(left) === minDepth;
    const rightContainer = depth(right) === minDepth;
    if (leftContainer !== rightContainer) return leftContainer ? 1 : -1;
    const delta = new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime();
    return delta !== 0 ? delta : left.taskId.localeCompare(right.taskId);
  });
}

export interface StepModelMetrics {
  characters: number;
  outputTokens?: number;
  occurredAt?: string;
}

/**
 * Decides whether a model/connector event belongs to a given step.
 *
 * The runtime emits `model.response.*` events under the scope prefix that was active at the call
 * site, which is usually a `/internal` child of the step's own task (e.g. the `compose` step's
 * writer emits under `compose/internal`, and `quality/revise/1` emits under
 * `quality/revise/1/internal`). So an event matches a step when its taskId equals the step's
 * taskId or is a descendant of it.
 *
 * `stepIds` is the full set of step taskIds in the run. When an event is nested under several
 * steps, it is attributed to the deepest one only — this keeps `research/internal/plan-queries`
 * events on the `plan-queries` step instead of also inflating the parent `research` step.
 */
export function eventBelongsToStep(
  eventTaskId: string | undefined,
  taskId: string,
  stepIds: Iterable<string>,
): boolean {
  if (!eventTaskId) return false;
  if (eventTaskId !== taskId && !eventTaskId.startsWith(`${taskId}/`)) return false;
  let deepest = taskId;
  for (const candidate of stepIds) {
    if (candidate === taskId) continue;
    const isAncestorOfEvent = candidate === eventTaskId || eventTaskId.startsWith(`${candidate}/`);
    const isDescendantOfStep = candidate.startsWith(`${taskId}/`);
    if (isAncestorOfEvent && isDescendantOfStep && candidate.length > deepest.length) {
      deepest = candidate;
    }
  }
  return deepest === taskId;
}

/**
 * Derives a one-line summary of what a step actually did from its recorded output.
 *
 * - plan-queries → the query strings, comma-joined
 * - search → how many results were returned, with the first result's title
 * - fetch → the page title and domain of the first fetched URL
 * - everything else → undefined (the label alone is sufficient)
 */
export function stepSummary(task: TaskRecord): string | undefined {
  const kind = stepKind(task.taskId);
  const output = task.output;

  if (kind === "plan-queries" && Array.isArray(output) && output.length) {
    const queries = output
      .filter((item): item is string => typeof item === "string")
      .slice(0, 3)
      .join("、");
    return queries || undefined;
  }

  if (kind === "search" && Array.isArray(output) && output.length) {
    const first = output[0];
    const title =
      isRecord(first) && typeof first.title === "string" ? first.title.slice(0, 40) : undefined;
    return `${output.length} 条结果${title ? `：${title}` : ""}`;
  }

  if (kind === "fetch" && Array.isArray(output) && output.length) {
    const first = output[0];
    if (!isRecord(first)) return undefined;
    if (typeof first.title === "string" && first.title) return first.title.slice(0, 50);
    if (typeof first.sourceUrl === "string" && first.sourceUrl) {
      try {
        return new URL(first.sourceUrl).hostname;
      } catch {
        return first.sourceUrl.slice(0, 50);
      }
    }
  }

  return undefined;
}

/** Extracts the meaningful kind keyword from a taskId, stripping stage root and indices. */
function stepKind(taskId: string): string {
  const segments = taskId.split("/").filter((s) => s && s !== "internal");
  const tail = segments.slice(1);
  const parts = tail.length ? tail : segments;
  return (parts[0] ?? "").replace(/^\d+-/, "").split(":")[0] ?? "";
}

/**
 * Aggregates language-model progress for a single step from its `model.response.*` events.
 *
 * Returns null when the step made no model call. While a step runs, `characters` tracks the largest
 * `accumulatedCharacters` seen (deltas are cumulative, so the max is the live total); once the
 * completion event carries token usage, `outputTokens` is preferred as the authoritative count.
 * `occurredAt` is the timestamp of the most recent model event.
 *
 * `stepIds` is the full set of step taskIds in the run, used to route each event to the deepest
 * step it belongs to (see `eventBelongsToStep`).
 */
export function stepModelMetrics(
  taskId: string,
  events: RuntimeEvent[],
  stepIds: Iterable<string>,
): StepModelMetrics | null {
  const ids = [...stepIds];
  let characters = 0;
  let outputTokens: number | undefined;
  let occurredAt: string | undefined;
  let sawModelEvent = false;

  for (const event of events) {
    if (!event.type.startsWith("model.response.")) continue;
    if (!eventBelongsToStep(event.taskId, taskId, ids)) continue;
    sawModelEvent = true;
    occurredAt = event.occurredAt;
    const data = isRecord(event.data) ? event.data : {};
    if (typeof data.accumulatedCharacters === "number") {
      characters = Math.max(characters, data.accumulatedCharacters);
    }
    const usage = isRecord(data.usage) ? data.usage : undefined;
    if (typeof usage?.outputTokens === "number") outputTokens = usage.outputTokens;
  }

  if (!sawModelEvent) return null;
  return { characters, outputTokens, occurredAt };
}

/** How much streamed model text to keep for the live preview; the tail is what is actively arriving. */
const LIVE_TEXT_LIMIT = 4000;

/**
 * Reconstructs the live streamed text of a step's most recent model response from its
 * `model.response.delta` events.
 *
 * Deltas are incremental chunks (not cumulative), so they are concatenated in order. A
 * `model.response.started` marks a fresh response and resets the buffer, so a retried or multi-call
 * step shows the latest attempt rather than a concatenation of all of them. Returns an empty string
 * when the step has emitted no delta yet. Only the trailing `LIVE_TEXT_LIMIT` characters are kept —
 * that is the part currently streaming in — prefixed with an ellipsis when truncated.
 */
export function stepModelText(
  taskId: string,
  events: RuntimeEvent[],
  stepIds: Iterable<string>,
): string {
  const ids = [...stepIds];
  let text = "";
  for (const event of events) {
    if (!event.type.startsWith("model.response.")) continue;
    if (!eventBelongsToStep(event.taskId, taskId, ids)) continue;
    if (event.type === "model.response.started") {
      text = "";
      continue;
    }
    if (event.type !== "model.response.delta") continue;
    const data = isRecord(event.data) ? event.data : {};
    if (typeof data.delta === "string") text += data.delta;
  }
  return text.length > LIVE_TEXT_LIMIT ? `…${text.slice(-LIVE_TEXT_LIMIT)}` : text;
}

/** Whether a step should be expanded by default: the ones a user is most likely to inspect. */
export function stepDefaultsOpen(status: TaskRecord["status"]): boolean {
  return (
    status === TaskStatus.Running || status === TaskStatus.Failed || status === TaskStatus.Unknown
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
