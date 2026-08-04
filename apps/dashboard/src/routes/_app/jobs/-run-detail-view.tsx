import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AudioLines,
  Bot,
  ChevronDown,
  FileCode2,
  Eye,
  FileOutput,
  Image as ImageIcon,
  Newspaper,
  Radio,
  RotateCcw,
  Send,
  Video,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  RunActivityKind,
  RunActivityStatus,
  RunSessionKind,
  RunStatus,
  type JsonValue,
  type ChannelPublicationPreview,
  type ModelStreamEvent,
  type RunActivity,
  type RunSession,
} from "#platform/api/types.ts";
import { useRunMonitor } from "#platform/api/use-run-monitor.ts";
import {
  contentPackageRunContextKey,
  getContentPackageRunContext,
} from "#platform/api/articles.ts";
import {
  channelPublicationPreviewKey,
  getChannelPublicationPreview,
  resumeRun,
  retryRunDestination,
} from "#platform/api/runs.ts";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import { AppDialog } from "#components/product/app-dialog.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { Tabs } from "#components/ui/tabs.tsx";
import { cn } from "#lib/utils.ts";
import { ContentPackagePreview } from "../library/-content-package-preview.tsx";
import { Route as AppRoute } from "../../_app.tsx";
import {
  runInstanceTitle,
  runStatusLabel,
  runStatusTone,
  runSummary,
  runTitle,
  sessionLabel,
} from "./-run-presentation.ts";

export function RunDetailView({
  runId,
  className,
  planScoped = false,
}: {
  runId: string | null;
  className?: string;
  planScoped?: boolean;
}) {
  const monitor = useRunMonitor(runId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = AppRoute.useSearch();
  const section = search.runTab === "publication" ? "publication" : "main";
  const [sectionDirection, setSectionDirection] = useState(1);
  const [sessionDirection, setSessionDirection] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [channelPreviewMode, setChannelPreviewMode] = useState<"cover" | "html" | null>(null);
  const reduceMotion = useReducedMotion();
  const resume = useMutation({
    mutationFn: () => resumeRun(runId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs", runId] }),
  });
  const retry = useMutation({
    mutationFn: (destinationId: string) => retryRunDestination(runId!, destinationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["runs", runId] }),
  });
  const detail = monitor.data;
  const packageContext = useQuery({
    queryKey: contentPackageRunContextKey(detail?.run.packageId),
    queryFn: () => getContentPackageRunContext(detail!.run.packageId!),
    enabled: Boolean(detail?.run.packageId),
  });
  const main = detail?.sessions.find((session) => session.kind === RunSessionKind.Main);
  const publications =
    detail?.sessions.filter((session) => session.kind === RunSessionKind.Publication) ?? [];
  const selectedSessionId = typeof search.destination === "string" ? search.destination : null;
  const selectedPublication =
    publications.find((session) => session.id === selectedSessionId) ?? publications[0];
  const selectedSession = section === "main" ? main : selectedPublication;
  const channelPreview = useQuery({
    queryKey: channelPublicationPreviewKey(runId, selectedPublication?.id),
    queryFn: () => getChannelPublicationPreview(runId!, selectedPublication!.id),
    enabled: Boolean(runId && selectedPublication && channelPreviewMode),
    retry: false,
  });
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const latestActivitySequence = monitor.activities.at(-1)?.sequence;
  const latestModelEventId = monitor.modelEvents.at(-1)?.id;

  const changeSection = (next: "main" | "publication") => {
    if (next === section) return;
    setSectionDirection(next === "publication" ? 1 : -1);
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, runTab: next }),
      resetScroll: false,
    });
  };
  const selectPublication = (nextId: string) => {
    const currentIndex = publications.findIndex((session) => session.id === selectedSessionId);
    const nextIndex = publications.findIndex((session) => session.id === nextId);
    setSessionDirection(currentIndex < 0 || nextIndex >= currentIndex ? 1 : -1);
    void navigate({
      to: ".",
      search: (previous) => ({
        ...previous,
        runTab: "publication",
        destination: nextId,
      }),
      resetScroll: false,
    });
  };

  useEffect(() => setPreviewOpen(false), [runId]);
  useEffect(() => setChannelPreviewMode(null), [runId, selectedPublication?.id]);

  useFollowLatest(
    detailScrollRef,
    `${selectedSession?.id ?? ""}:${latestActivitySequence ?? ""}:${latestModelEventId ?? ""}`,
    planScoped,
    selectedSession?.id,
  );

  if (!runId)
    return (
      <EmptyState
        className={cn(
          "min-h-[420px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]",
          className,
        )}
        title="选择一次运行"
        description="查看动态 ReAct 活动、实时模型输出和独立发布结果。"
      />
    );
  if (monitor.error)
    return (
      <div className={className}>
        <FormError error={monitor.error} />
      </div>
    );
  if (!detail)
    return <div className={cn("h-80 animate-pulse rounded bg-[var(--surface-2)]", className)} />;

  const recoverable =
    detail.run.status === RunStatus.Failed ||
    (detail.run.status === RunStatus.NeedsAttention && main?.status === RunStatus.NeedsAttention);
  const sectionSwitcher = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs
        value={section}
        onChange={changeSection}
        items={[
          { value: "main", label: "主流程", icon: <Bot className="size-3.5" /> },
          {
            value: "publication",
            label: `发布（${publications.length}）`,
            icon: <Radio className="size-3.5" />,
          },
        ]}
      />
      <span className="text-[11px] text-[var(--muted)]">
        活动流：{streamStateLabel(monitor.activityStreamState)} · 模型流：
        {streamStateLabel(monitor.modelStreamState)}
      </span>
    </div>
  );
  return (
    <>
      <section
        className={cn(
          "grid gap-4",
          planScoped && "h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden",
          className,
        )}
      >
        {planScoped ? sectionSwitcher : null}
        <div
          ref={detailScrollRef}
          className={cn(
            "grid gap-4",
            planScoped &&
              "scrollbar-stable min-h-0 content-start overflow-y-auto overscroll-contain",
          )}
        >
          <header className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold">
                    {planScoped ? runInstanceTitle(detail.run) : runTitle(detail.run)}
                  </h2>
                  <Badge tone={runStatusTone(detail.run.status)}>
                    {runStatusLabel(detail.run.status)}
                  </Badge>
                  {detail.run.trigger.kind === "automation" ? <Badge>自动任务</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-[var(--muted-strong)]">
                  {planScoped ? null : <>{detail.run.planName ?? "独立发布"} · </>}
                  {planScoped ? null : <>{runSummary(detail.run)} · </>}
                  {new Date(detail.run.createdAt).toLocaleString()}
                </p>
                {packageContext.data ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {detail.run.kind === "publication" && packageContext.data.generationRun
                      ? `内容来自 ${runInstanceTitle(packageContext.data.generationRun)}`
                      : "已生成可发布内容包"}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {packageContext.data ? (
                  <Button onClick={() => setPreviewOpen(true)}>
                    <Eye className="size-4" />
                    预览内容
                  </Button>
                ) : null}
                {recoverable ? (
                  <Button loading={resume.isPending} onClick={() => resume.mutate()}>
                    <RotateCcw className="size-4" />
                    恢复运行
                  </Button>
                ) : null}
              </div>
            </div>
            {detail.run.error ? (
              <p className="mt-3 text-xs text-[var(--danger)]">{detail.run.error}</p>
            ) : null}
          </header>

          {planScoped ? null : sectionSwitcher}

          <AnimatePresence initial={false} mode="wait" custom={sectionDirection}>
            <motion.div
              key={section}
              custom={sectionDirection}
              initial={{
                opacity: 0,
                x: reduceMotion ? 0 : sectionDirection * 18,
                filter: reduceMotion ? "none" : "blur(3px)",
              }}
              animate={{ opacity: 1, x: 0, filter: "none" }}
              exit={{
                opacity: 0,
                x: reduceMotion ? 0 : sectionDirection * -12,
                filter: reduceMotion ? "none" : "blur(2px)",
              }}
              transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {section === "publication" && !publications.length ? (
                <EmptyState
                  className="min-h-64 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
                  title="仅生成可发布内容包"
                  description="本次运行没有配置发布目的地。"
                />
              ) : (
                <div className="grid gap-4">
                  {section === "publication" ? (
                    <PublicationFlow
                      sessions={publications}
                      selected={selectedPublication?.id}
                      sourceTitle={runTitle(detail.run)}
                      onSelect={selectPublication}
                    />
                  ) : null}
                  <AnimatePresence initial={false} mode="wait" custom={sessionDirection}>
                    <motion.div
                      key={selectedSession?.id ?? `${section}-empty`}
                      custom={sessionDirection}
                      initial={{ opacity: 0, x: reduceMotion ? 0 : sessionDirection * 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: reduceMotion ? 0 : sessionDirection * -10 }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.18,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="min-w-0"
                    >
                      {selectedSession ? (
                        <SessionDetail
                          session={selectedSession}
                          activities={monitor.activities.filter(
                            (item) => item.sessionId === selectedSession.id,
                          )}
                          modelEvents={monitor.modelEvents.filter(
                            (item) => item.sessionId === selectedSession.id,
                          )}
                          retrying={retry.isPending}
                          hideHeader={selectedSession.kind === RunSessionKind.Main}
                          onPreviewCover={
                            isWeixinArticleSession(selectedSession)
                              ? () => setChannelPreviewMode("cover")
                              : undefined
                          }
                          onPreviewHtml={
                            isWeixinArticleSession(selectedSession)
                              ? () => setChannelPreviewMode("html")
                              : undefined
                          }
                          onRetry={
                            selectedSession.destination &&
                            selectedSession.status === RunStatus.Failed
                              ? () => retry.mutate(selectedSession.destination!.destinationId)
                              : undefined
                          }
                        />
                      ) : (
                        <EmptyState title="会话尚未开始" description="运行开始后会实时显示活动。" />
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>
      {packageContext.data ? (
        <AppDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          title={packageContext.data.contentPackage.contentPackage.document.title}
          description={`${packageContext.data.contentPackage.contentPackage.schemaVersion} · 运行产物`}
          size="wide"
        >
          <ContentPackagePreview
            value={packageContext.data.contentPackage}
            generationRun={packageContext.data.generationRun}
          />
        </AppDialog>
      ) : null}
      <ChannelPreviewDialog
        mode={channelPreviewMode}
        preview={channelPreview.data}
        pending={channelPreview.isPending}
        error={channelPreview.error}
        onOpenChange={(open) => {
          if (!open) setChannelPreviewMode(null);
        }}
      />
    </>
  );
}

const PUBLICATION_FLOW_NODE_HEIGHT = 68;
const PUBLICATION_FLOW_NODE_GAP = 10;

function PublicationFlow({
  sessions,
  selected,
  sourceTitle,
  onSelect,
}: {
  sessions: RunSession[];
  selected?: string;
  sourceTitle: string;
  onSelect(id: string): void;
}) {
  const reduceMotion = useReducedMotion();
  const canvasHeight =
    sessions.length * PUBLICATION_FLOW_NODE_HEIGHT +
    Math.max(0, sessions.length - 1) * PUBLICATION_FLOW_NODE_GAP;
  const sourceY = canvasHeight / 2;
  const selectedIndex = sessions.findIndex((session) => session.id === selected);
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <strong className="text-sm">发布流程</strong>
        <span className="text-[11px] text-[var(--muted)]">
          {sessions.filter((session) => session.status === RunStatus.Succeeded).length}/
          {sessions.length} 个目的地完成
        </span>
      </div>
      <div className="publication-flow-canvas">
        <motion.div
          className="publication-flow-source-wrap"
          initial={{ opacity: 0, x: reduceMotion ? 0 : -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="publication-flow-source publication-flow-node">
            <span className="publication-flow-icon">
              <FileOutput className="size-4" />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-xs font-semibold">可发布内容包</strong>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                {sourceTitle}
              </span>
            </span>
          </div>
        </motion.div>

        <div className="publication-flow-rail" aria-hidden="true">
          <span
            className="publication-flow-line publication-flow-source-line"
            style={{ top: sourceY }}
          />
          <span
            className="publication-flow-line publication-flow-trunk"
            style={{
              top: PUBLICATION_FLOW_NODE_HEIGHT / 2,
              height: Math.max(0, canvasHeight - PUBLICATION_FLOW_NODE_HEIGHT),
            }}
          />
          {sessions.map((session, index) => {
            const targetY = publicationFlowTargetY(index);
            return (
              <span
                key={`branch-${session.id}`}
                className="publication-flow-line publication-flow-branch"
                data-status={session.status}
                style={{ top: targetY }}
              />
            );
          })}
          {selectedIndex >= 0 ? (
            <PublicationFlowPath
              className="publication-flow-selection-line"
              sourceY={sourceY}
              targetY={publicationFlowTargetY(selectedIndex)}
            />
          ) : null}
          {sessions.map((session, index) =>
            session.status === RunStatus.Running ? (
              <PublicationFlowPath
                key={`signal-${session.id}`}
                className="publication-flow-signal"
                sourceY={sourceY}
                targetY={publicationFlowTargetY(index)}
                animated
              />
            ) : null,
          )}
        </div>

        <div className="publication-flow-destinations">
          {sessions.map((session, index) => {
            const isSelected = selected === session.id;
            return (
              <motion.button
                layout="position"
                key={session.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(session.id)}
                initial={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.3,
                  delay: reduceMotion ? 0 : Math.min(index * 0.045, 0.18),
                  ease: [0.16, 1, 0.3, 1],
                }}
                className={cn(
                  "publication-flow-channel publication-flow-node",
                  isSelected && "is-selected",
                )}
              >
                {isSelected ? (
                  <motion.span
                    layoutId="publication-flow-selected-node"
                    className="publication-flow-selection"
                    transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : null}
                <span className="publication-flow-port" data-status={session.status} />
                <span className="publication-flow-icon">{publicationIcon(session)}</span>
                <span className="relative min-w-0 flex-1 text-left">
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <strong className="truncate text-xs font-semibold">
                      {session.destination?.accountName ?? "发布账号"}
                    </strong>
                    <Badge tone={runStatusTone(session.status)}>
                      {runStatusLabel(session.status)}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                    {publicationChannelLabel(session)} · {session.currentActivity ?? "等待开始"}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PublicationFlowPath({
  className,
  sourceY,
  targetY,
  animated = false,
}: {
  className: string;
  sourceY: number;
  targetY: number;
  animated?: boolean;
}) {
  const verticalTop = Math.min(sourceY, targetY);
  const verticalHeight = Math.abs(sourceY - targetY);
  return (
    <>
      <span
        className={cn(className, "publication-flow-path-source", animated && "is-animated")}
        style={{ top: sourceY }}
      />
      {verticalHeight ? (
        <span
          className={cn(className, "publication-flow-path-vertical", animated && "is-animated")}
          data-direction={targetY < sourceY ? "up" : "down"}
          style={{ top: verticalTop, height: verticalHeight }}
        />
      ) : null}
      <span
        className={cn(className, "publication-flow-path-branch", animated && "is-animated")}
        style={{ top: targetY }}
      />
    </>
  );
}

function publicationFlowTargetY(index: number): number {
  return (
    PUBLICATION_FLOW_NODE_HEIGHT / 2 +
    index * (PUBLICATION_FLOW_NODE_HEIGHT + PUBLICATION_FLOW_NODE_GAP)
  );
}

function publicationChannelLabel(session: RunSession): string {
  const channel = session.destination?.channel;
  const publicationType = session.destination?.publicationType;
  const channelName = channel === "weixin-official-account" ? "微信公众号" : channel || "发布渠道";
  const typeName = publicationType === "article" ? "图文" : publicationType || "内容";
  return `${channelName} · ${typeName}`;
}

function publicationIcon(session: RunSession): ReactNode {
  if (session.destination?.publicationType === "video") return <Video className="size-4" />;
  if (session.destination?.publicationType === "audio") return <AudioLines className="size-4" />;
  if (session.destination?.channel === "weixin-official-account") {
    return <Newspaper className="size-4" />;
  }
  return <Send className="size-4" />;
}

function isWeixinArticleSession(session: RunSession): boolean {
  return (
    session.kind === RunSessionKind.Publication &&
    session.destination?.channel === "weixin-official-account" &&
    session.destination.publicationType === "article"
  );
}

function ChannelPreviewDialog({
  mode,
  preview,
  pending,
  error,
  onOpenChange,
}: {
  mode: "cover" | "html" | null;
  preview?: ChannelPublicationPreview;
  pending: boolean;
  error: unknown;
  onOpenChange(open: boolean): void;
}) {
  const title = mode === "cover" ? "微信封面预览" : "微信 HTML 预览";
  return (
    <AppDialog
      open={mode !== null}
      onOpenChange={onOpenChange}
      title={preview?.title || title}
      description={title}
      size={mode === "html" ? "wide" : "medium"}
    >
      {pending ? (
        <div className="grid min-h-72 place-items-center" aria-live="polite">
          <span className="text-sm text-[var(--muted)]">正在读取渠道准备结果…</span>
        </div>
      ) : error ? (
        <div className="grid min-h-48 content-center gap-3">
          <FormError error={error} />
          <p className="text-center text-xs leading-5 text-[var(--muted)]">
            渠道 ReAct 完成内容准备后即可查看，不需要等待发布执行结束。
          </p>
        </div>
      ) : mode === "cover" ? (
        preview?.cover ? (
          <figure className="grid gap-3">
            <div className="grid aspect-video place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-2)]">
              <img
                src={preview.cover.source}
                alt={preview.cover.alt || `${preview.title}封面`}
                className="h-full w-full object-contain"
              />
            </div>
            <figcaption className="text-center text-xs leading-5 text-[var(--muted)]">
              {preview.cover.alt || preview.title}
            </figcaption>
          </figure>
        ) : (
          <EmptyState
            title="没有可预览的封面"
            description="渠道准备结果未包含安全的封面图片地址。"
          />
        )
      ) : preview?.body.format === "html" ? (
        <iframe
          title={`${preview.title}微信 HTML 预览`}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={channelPreviewDocument(preview.body.content)}
          className="h-[min(680px,70dvh)] w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-white"
        />
      ) : (
        <EmptyState title="没有 HTML 预览" description="该渠道准备结果不是 HTML 格式。" />
      )}
    </AppDialog>
  );
}

export function channelPreviewDocument(content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; font-src data: http: https:; base-uri 'none'; form-action 'none'">
  <style>html{background:#fff}body{box-sizing:border-box;max-width:677px;margin:0 auto;padding:24px 20px;color:#222;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{overflow:auto;white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}</style>
</head>
<body>${content}</body>
</html>`;
}

function SessionDetail({
  session,
  activities,
  modelEvents,
  retrying,
  hideHeader,
  onPreviewCover,
  onPreviewHtml,
  onRetry,
}: {
  session: RunSession;
  activities: RunActivity[];
  modelEvents: ModelStreamEvent[];
  retrying: boolean;
  hideHeader: boolean;
  onPreviewCover?: () => void;
  onPreviewHtml?: () => void;
  onRetry?: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      {!hideHeader ? (
        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <strong className="text-sm">{sessionLabel(session)}</strong>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {session.kind === RunSessionKind.Publication
                  ? "渠道内容准备 · 发布执行"
                  : "动态 ReAct 主会话"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {onPreviewCover ? (
                <Button size="sm" onClick={onPreviewCover}>
                  <ImageIcon className="size-4" />
                  封面预览
                </Button>
              ) : null}
              {onPreviewHtml ? (
                <Button size="sm" onClick={onPreviewHtml}>
                  <FileCode2 className="size-4" />
                  HTML 预览
                </Button>
              ) : null}
              <Badge tone={runStatusTone(session.status)}>{runStatusLabel(session.status)}</Badge>
              {onRetry ? (
                <Button loading={retrying} onClick={onRetry}>
                  <RotateCcw className="size-4" />
                  重试目的地
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <ActivityTimeline
        activities={settleInterruptedActivities(activities, session)}
        modelEvents={modelEvents}
      />
    </div>
  );
}

function ActivityTimeline({
  activities,
  modelEvents,
}: {
  activities: RunActivity[];
  modelEvents: ModelStreamEvent[];
}) {
  const outputs = useMemo(() => modelOutputs(modelEvents), [modelEvents]);
  const visibleActivities = useMemo(
    () => activities.filter((activity) => !isLegacyExternalQualityActivity(activity)),
    [activities],
  );
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <Wrench className="size-4" />
        <strong className="text-sm">运行活动</strong>
        <span className="text-[11px] text-[var(--muted)]">可恢复历史</span>
      </div>
      {visibleActivities.length ? (
        <ol className="divide-y divide-[var(--border)]">
          <AnimatePresence initial={false}>
            {visibleActivities.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                modelOutput={activity.taskId ? outputs.get(activity.taskId) : undefined}
              />
            ))}
          </AnimatePresence>
        </ol>
      ) : (
        <p className="px-4 py-8 text-center text-xs text-[var(--muted)]">尚无活动记录</p>
      )}
    </section>
  );
}

export function settleInterruptedActivities(
  activities: RunActivity[],
  session: Pick<RunSession, "status" | "error" | "finishedAt" | "updatedAt">,
): RunActivity[] {
  if (session.status !== RunStatus.Failed && session.status !== RunStatus.NeedsAttention) {
    return activities;
  }
  return activities.map((activity) =>
    activity.status === RunActivityStatus.Running
      ? {
          ...activity,
          status:
            session.status === RunStatus.NeedsAttention
              ? RunActivityStatus.NeedsAttention
              : RunActivityStatus.Failed,
          error:
            activity.error ??
            (session.status === RunStatus.NeedsAttention
              ? "服务重启，本轮执行已中断"
              : session.error),
          finishedAt: session.finishedAt ?? session.updatedAt,
          updatedAt: session.finishedAt ?? session.updatedAt,
        }
      : activity,
  );
}

export function isLegacyExternalQualityActivity(activity: RunActivity): boolean {
  return Boolean(activity.taskId?.split("/").includes("quality"));
}

function ActivityRow({
  activity,
  modelOutput,
}: {
  activity: RunActivity;
  modelOutput?: ModelOutput;
}) {
  const [open, setOpen] = useState(false);
  const isModel = activity.kind === RunActivityKind.ModelTurn;
  const reduceMotion = useReducedMotion();
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8, filter: reduceMotion ? "none" : "blur(3px)" }}
      animate={{ opacity: 1, y: 0, filter: "none" }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="px-4 py-3"
    >
      <button
        type="button"
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <strong className="truncate text-xs font-medium">{activity.label}</strong>
            <Badge tone={activityTone(activity.status)}>{activityStatusLabel(activity)}</Badge>
          </span>
          {activity.summary ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">{activity.summary}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
          {new Date(activity.updatedAt).toLocaleTimeString()}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {activity.error ? (
        <p className="mt-2 text-xs text-[var(--danger)]">{activity.error}</p>
      ) : null}
      {isModel && (modelOutput || activity.status === RunActivityStatus.Running) ? (
        <ModelActivityOutput activity={activity} output={modelOutput} />
      ) : null}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3">
              <p className="font-mono text-[10px] text-[var(--muted)]">
                {activity.taskId ?? activity.id} · 尝试 {activity.attempt ?? 1}
              </p>
              {activity.input !== undefined ? (
                <JsonPreview title="输入摘要" value={activity.input} />
              ) : null}
              {activity.output !== undefined ? (
                <JsonPreview title="输出摘要" value={activity.output} />
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

function ModelActivityOutput({
  activity,
  output,
}: {
  activity: RunActivity;
  output?: ModelOutput;
}) {
  const durationMs = useLiveActivityDuration(activity);
  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--muted)]">
        <span>{output?.model ?? "模型生成中"}</span>
        <span>{modelOutputCharacters(output)} 字符</span>
        {output?.toolCharacters ? <span>工具参数 {output.toolCharacters} 字符</span> : null}
        {output?.tokens !== undefined ? <span>{output.tokens} tokens</span> : null}
        <span>{formatDuration(durationMs)}</span>
      </div>
      {output?.content ? (
        <FollowLatestPre
          value={output.content}
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 font-mono text-[11px] leading-5"
        />
      ) : null}
      {(output?.tools ?? []).map((tool) => (
        <FollowLatestPre
          key={tool.index}
          value={formatToolArguments(tool.arguments)}
          className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-sm)] border border-[var(--border)] p-3 font-mono text-[10px] leading-5"
          prefix={<strong>{tool.name || `Tool Call ${tool.index + 1}`}</strong>}
        />
      ))}
    </div>
  );
}

function JsonPreview({ title, value }: { title: string; value: JsonValue }) {
  return (
    <div>
      <strong className="text-[10px] text-[var(--muted)]">{title}</strong>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--surface-2)] p-2 font-mono text-[10px] leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export interface ModelOutput {
  model?: string;
  content: string;
  characters: number;
  toolCharacters: number;
  partial: boolean;
  tokens?: number;
  tools: Array<{ index: number; name?: string; arguments: string }>;
}

export function modelOutputs(events: ModelStreamEvent[]): Map<string, ModelOutput> {
  const outputs = new Map<string, ModelOutput>();
  for (const event of events) {
    if (!event.taskId) continue;
    const data = record(event.data);
    const current = outputs.get(event.taskId) ?? {
      content: "",
      characters: 0,
      toolCharacters: 0,
      partial: false,
      tools: [],
    };
    if (typeof data.model === "string") current.model = data.model;
    if (event.type === "response.delta" && typeof data.delta === "string") {
      current.content += data.delta;
      const accumulatedCharacters =
        typeof data.accumulatedCharacters === "number"
          ? data.accumulatedCharacters
          : current.content.length;
      current.characters = accumulatedCharacters;
      if (accumulatedCharacters > current.content.length) current.partial = true;
    }
    if (event.type === "response.tool_delta") {
      const index = typeof data.index === "number" ? data.index : 0;
      const tool = current.tools.find((item) => item.index === index) ?? { index, arguments: "" };
      if (!current.tools.includes(tool)) current.tools.push(tool);
      if (typeof data.name === "string") tool.name = data.name;
      if (typeof data.accumulatedArguments === "string") tool.arguments = data.accumulatedArguments;
      current.toolCharacters = current.tools.reduce(
        (total, candidate) => total + candidate.arguments.length,
        0,
      );
    }
    if (event.type === "response.completed") {
      current.tokens = usageTokens(data.usage);
      if (typeof data.accumulatedCharacters === "number") {
        current.characters = data.accumulatedCharacters;
        if (data.accumulatedCharacters > current.content.length) current.partial = true;
      }
    }
    outputs.set(event.taskId, current);
  }
  return outputs;
}

export function modelOutputCharacters(output: ModelOutput | undefined): number {
  return (output?.characters ?? 0) + (output?.toolCharacters ?? 0);
}

function usageTokens(value: JsonValue | undefined): number | undefined {
  const usage = record(value ?? null);
  const total = usage.totalTokens ?? usage.total_tokens;
  return typeof total === "number" ? total : undefined;
}

export function formatToolArguments(value: string): string {
  if (!value.trim()) return "等待参数…";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return decodeStreamingUnicodeEscapes(value);
  }
}

function decodeStreamingUnicodeEscapes(value: string): string {
  return value.replace(/\\u([\dA-Fa-f]{4})/g, (_match, hexadecimal: string) =>
    String.fromCharCode(Number.parseInt(hexadecimal, 16)),
  );
}

function FollowLatestPre({
  value,
  className,
  prefix,
}: {
  value: string;
  className: string;
  prefix?: ReactNode;
}) {
  const ref = useRef<HTMLPreElement>(null);
  useFollowLatest(ref, value);
  return (
    <pre ref={ref} className={className}>
      {prefix ? (
        <>
          {prefix}
          {"\n"}
        </>
      ) : null}
      {value}
    </pre>
  );
}

function useFollowLatest<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  updateKey: string | number | undefined,
  enabled = true,
  resetKey?: string,
): void {
  const shouldFollow = useRef(true);
  const previousResetKey = useRef(resetKey);

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    shouldFollow.current = false;
    if (enabled && ref.current) ref.current.scrollTop = 0;
  }, [enabled, ref, resetKey]);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) return;
    const onScroll = () => {
      shouldFollow.current = isNearScrollEnd(element);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [enabled, ref]);

  useEffect(() => {
    if (!enabled || !ref.current || !shouldFollow.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [enabled, ref, updateKey]);
}

export function isNearScrollEnd(
  value: Pick<HTMLElement, "scrollHeight" | "clientHeight" | "scrollTop">,
): boolean {
  return value.scrollHeight - value.clientHeight - value.scrollTop <= 32;
}

function useLiveActivityDuration(activity: RunActivity): number {
  const running = activity.status === RunActivityStatus.Running;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [running]);
  return activityDuration(activity, now);
}

export function activityDuration(activity: RunActivity, now = Date.now()): number {
  const startedAt = Date.parse(activity.startedAt);
  if (!Number.isFinite(startedAt)) return 0;
  const finishedAt = activity.finishedAt ? Date.parse(activity.finishedAt) : Number.NaN;
  const end =
    activity.status === RunActivityStatus.Running || !Number.isFinite(finishedAt)
      ? now
      : finishedAt;
  return Math.max(0, end - startedAt);
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
}

function record(value: JsonValue): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {};
}

function activityStatusLabel(activity: Pick<RunActivity, "status" | "error">): string {
  if (activity.status === RunActivityStatus.Running) return "进行中";
  if (activity.status === RunActivityStatus.Succeeded) return "完成";
  if (
    activity.status === RunActivityStatus.NeedsAttention &&
    activity.error?.includes("本轮执行已中断")
  )
    return "已中断";
  if (activity.status === RunActivityStatus.NeedsAttention) return "需要处理";
  return "失败";
}

function activityTone(status: RunActivity["status"]): "info" | "success" | "warning" | "danger" {
  if (status === RunActivityStatus.Running) return "info";
  if (status === RunActivityStatus.Succeeded) return "success";
  if (status === RunActivityStatus.NeedsAttention) return "warning";
  return "danger";
}

function streamStateLabel(state: string): string {
  if (state === "live") return "实时";
  if (state === "retrying") return "恢复中";
  if (state === "unavailable") return "轮询";
  if (state === "connecting") return "连接中";
  return "待机";
}
