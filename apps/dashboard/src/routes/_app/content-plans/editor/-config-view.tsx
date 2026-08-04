import { BookOpen, CircleCheck, Fingerprint, Globe2, RadioTower, Settings2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SaveContentPlanPayload, WorkspaceSnapshot } from "#platform/api/types.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { cn } from "#lib/utils.ts";
import { FormError } from "#components/product/form-error.tsx";
import { PublicationDestinationPicker } from "#components/product/publication-destination-picker.tsx";
import { AssociationList } from "./-association-list.tsx";

const sections = [
  ["basic", "Agent 设置", "策略、模型与预算", Settings2],
  ["identity", "内容身份", "定位、受众和语气", Fingerprint],
  ["knowledge", "知识库", "长期参考材料", BookOpen],
  ["sources", "输入来源", "运行时内容输入", Globe2],
  ["publishing", "发布账号", "多渠道发布目的地", RadioTower],
] as const;

export type SectionId = (typeof sections)[number][0];
export function ConfigView({
  section,
  onSectionChange,
  form,
  update,
  workspace,
  error,
}: {
  section: SectionId;
  onSectionChange(value: SectionId): void;
  form: SaveContentPlanPayload;
  update(value: SaveContentPlanPayload): void;
  workspace: WorkspaceSnapshot | undefined;
  error: unknown;
}) {
  const reduceMotion = useReducedMotion();
  const activeIndex = sections.findIndex(([id]) => id === section);
  return (
    <div className="grid min-h-0 gap-2 lg:h-full lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-hidden">
      <nav
        aria-label="内容方案配置模块"
        className="min-w-0 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 lg:h-full"
      >
        <div className="flex gap-1 overflow-x-auto lg:grid lg:overflow-visible">
          {sections.map(([id, title, detail, Icon]) => {
            const complete = sectionComplete(id, form);
            return (
              <div key={id} className="min-w-[164px] lg:min-w-0">
                <button
                  type="button"
                  onClick={() => onSectionChange(id)}
                  className={cn(
                    "relative isolate flex w-full items-center gap-3 overflow-hidden rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                    section === id
                      ? "text-[var(--ink)]"
                      : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  {section === id ? (
                    <motion.span
                      layoutId="content-plan-section-active"
                      className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-[var(--surface-2)]"
                      transition={{
                        duration: reduceMotion ? 0 : 0.28,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                    />
                  ) : null}
                  <span className="relative z-10 grid size-6 shrink-0 place-items-center text-[var(--muted-strong)]">
                    <Icon className="size-4" />
                  </span>
                  <span className="relative z-10 min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <strong className="block truncate text-sm font-semibold">{title}</strong>
                      {complete ? (
                        <CircleCheck className="size-3.5 shrink-0 text-[var(--success)]" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                      {detail}
                    </span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </nav>
      <div className="scrollbar-stable min-h-[560px] min-w-0 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7 lg:py-6">
          <AnimatePresence initial={false} mode="wait" custom={activeIndex}>
            <motion.div
              key={section}
              initial={{
                opacity: 0,
                x: reduceMotion ? 0 : 18,
                clipPath: reduceMotion ? "none" : "inset(0 0 0 12px)",
              }}
              animate={{ opacity: 1, x: 0, clipPath: "inset(0 0 0 0)" }}
              exit={{
                opacity: 0,
                x: reduceMotion ? 0 : -12,
                clipPath: reduceMotion ? "none" : "inset(0 12px 0 0)",
              }}
              transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <SectionHeader section={section} />
              <div className="mt-6">
                <SectionContent
                  section={section}
                  form={form}
                  update={update}
                  workspace={workspace}
                />
              </div>
              <FormError error={error} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ section }: { section: SectionId }) {
  const item = sections.find(([id]) => id === section)!;
  const descriptions: Record<SectionId, string> = {
    basic: "选择 ReAct 策略和原生 Tool Calling 模型；策略不规定工具顺序。",
    identity: "选择内容表达主体；身份只负责定位、受众、语气和边界。",
    knowledge: "选择已上传的长期参考材料，不会在运行时重新抓取。",
    sources: "选择 URL、查询等来源集合；工具连接统一在 Agent 设置中授权。",
    publishing: "直接选择一个或多个账号；系统按渠道和发布类型启动独立 ReAct 会话。",
  };
  return (
    <header>
      <h3 className="text-base font-semibold">{item[1]}</h3>
      <p className="mt-1 text-sm text-[var(--muted-strong)]">{descriptions[section]}</p>
    </header>
  );
}

function SectionContent({
  section,
  form,
  update,
  workspace,
}: {
  section: SectionId;
  form: SaveContentPlanPayload;
  update(value: SaveContentPlanPayload): void;
  workspace: WorkspaceSnapshot | undefined;
}) {
  if (!workspace) return <p className="text-sm text-[var(--muted)]">正在加载配置…</p>;
  const definitions = new Map(workspace.connectorDefinitions.map((item) => [item.id, item]));
  const connections = (capability: string) =>
    workspace.connections.filter(
      (connection) =>
        connection.enabled &&
        definitions.get(connection.connectorId)?.capabilities.includes(capability),
    );
  const enabledIdentities = workspace.identities.filter((item) => item.enabled);
  const enabledKnowledgeBases = workspace.knowledgeBases.filter((item) => item.enabled);
  const enabledSources = workspace.sourceCollections.filter((item) => item.enabled);
  if (section === "basic") {
    const agent = resolvedAgent(form);
    const toolConnections = workspace.connections.filter((connection) => {
      if (!connection.enabled) return false;
      const capabilities = definitions.get(connection.connectorId)?.capabilities ?? [];
      return capabilities.some((capability) =>
        ["source-search", "source-fetch"].includes(capability),
      );
    });
    const connectionOption = (id: string) => {
      const connection = workspace.connections.find((candidate) => candidate.id === id);
      return connection
        ? {
            id,
            name: connection.name,
            detail: definitions.get(connection.connectorId)?.displayName ?? connection.connectorId,
          }
        : undefined;
    };
    return (
      <div className="grid gap-5 md:grid-cols-2">
        <FormField label="方案名称" required>
          <Input
            value={form.name}
            onChange={(event) => update({ ...form, name: event.target.value })}
            placeholder="例如：工程观察日报"
          />
        </FormField>
        <FormField label="生成模型" required>
          <NativeSelect
            value={agent.modelConnectionId}
            onChange={(event) =>
              update({
                ...form,
                connections: { ...form.connections, chat: event.target.value },
                agent: { ...agent, modelConnectionId: event.target.value },
              })
            }
          >
            <option value="">请选择 Chat 连接</option>
            {connections("chat").map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Agent 策略" required className="md:col-span-2">
          <NativeSelect
            value={agent.strategyId}
            onChange={(event) =>
              update({
                ...form,
                templateId: event.target.value as SaveContentPlanPayload["templateId"],
                agent: {
                  ...agent,
                  strategyId: event.target.value as typeof agent.strategyId,
                },
              })
            }
          >
            {workspace.contentPlanTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · {template.description}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <section className="grid gap-2 border-t border-[var(--border)] pt-4 md:col-span-2">
          <div>
            <h4 className="text-sm font-semibold">Agent 工具权限</h4>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              搜索和网页抓取连接会成为内容 Agent 的可调用工具；发布器工具由发布账号单独引用。
            </p>
          </div>
          <AssociationList
            items={agent.toolConnectionIds.flatMap((id) => {
              const option = connectionOption(id);
              return option ? [option] : [];
            })}
            available={toolConnections
              .filter((item) => !agent.toolConnectionIds.includes(item.id))
              .map((item) => connectionOption(item.id)!)}
            empty="尚未授权搜索或抓取工具"
            addLabel="添加工具连接"
            onAdd={(id) =>
              update({
                ...form,
                agent: { ...agent, toolConnectionIds: [...agent.toolConnectionIds, id] },
              })
            }
            onRemove={(id) =>
              update({
                ...form,
                agent: {
                  ...agent,
                  toolConnectionIds: agent.toolConnectionIds.filter((item) => item !== id),
                },
              })
            }
          />
        </section>
        <details className="border-t border-[var(--border)] pt-4 md:col-span-2">
          <summary className="cursor-pointer text-sm font-medium">运行预算</summary>
          <div className="mt-4 max-w-sm">
            <FormField
              label="最大 Agent 轮次"
              helper="默认 24，范围 1–100；最后一轮只用于提交当前最佳结果"
            >
              <Input
                type="number"
                min={1}
                max={100}
                value={agent.budget?.maxTurns ?? 24}
                onChange={(event) =>
                  update({
                    ...form,
                    agent: {
                      ...agent,
                      budget: { ...agent.budget, maxTurns: Number(event.target.value) },
                    },
                  })
                }
              />
            </FormField>
          </div>
        </details>
      </div>
    );
  }
  if (section === "identity") {
    if (!enabledIdentities.length)
      return (
        <EmptyState
          className="min-h-48 border-y border-[var(--border)]"
          title="还没有内容身份"
          description="先创建一个身份，定义内容的定位、受众、语气和表达边界。"
          action={
            <Button size="sm" onClick={() => (window.location.href = "/dashboard/identities")}>
              创建内容身份
            </Button>
          }
        />
      );
    const selected = workspace.identities.find((item) => item.id === form.identityId);
    return (
      <AssociationList
        items={
          selected
            ? [
                {
                  id: selected.id,
                  name: selected.name,
                  detail: `定位：${selected.positioning}　语气：${selected.tone}`,
                },
              ]
            : []
        }
        available={
          selected
            ? []
            : enabledIdentities.map((item) => ({
                id: item.id,
                name: item.name,
                detail: `定位：${item.positioning}　语气：${item.tone}`,
              }))
        }
        empty="还没有添加内容身份"
        addLabel="添加内容身份"
        onAdd={(id) => update({ ...form, identityId: id })}
        onRemove={() => update({ ...form, identityId: "" })}
      />
    );
  }
  if (section === "knowledge") {
    if (!enabledKnowledgeBases.length)
      return (
        <EmptyState
          className="min-h-48 border-y border-[var(--border)]"
          title="还没有知识库"
          description="知识库用于保存长期参考材料；这一步也可以暂时跳过。"
          action={
            <Button size="sm" onClick={() => (window.location.href = "/dashboard/knowledge")}>
              新建知识库
            </Button>
          }
        />
      );
    return (
      <AssociationList
        items={form.knowledgeBaseIds.flatMap((id) => {
          const item = workspace.knowledgeBases.find((candidate) => candidate.id === id);
          return item
            ? [{ id: item.id, name: item.name, detail: `${item.documents.length} 份参考文档` }]
            : [];
        })}
        available={enabledKnowledgeBases
          .filter((item) => !form.knowledgeBaseIds.includes(item.id))
          .map((item) => ({
            id: item.id,
            name: item.name,
            detail: `${item.documents.length} 份参考文档`,
          }))}
        empty="还没有添加知识库"
        addLabel="添加知识库"
        onAdd={(id) => update({ ...form, knowledgeBaseIds: [...form.knowledgeBaseIds, id] })}
        onRemove={(id) =>
          update({
            ...form,
            knowledgeBaseIds: form.knowledgeBaseIds.filter((item) => item !== id),
          })
        }
      />
    );
  }
  if (section === "sources") {
    return (
      <AssociationList
        items={form.sourceCollectionIds.flatMap((id) => {
          const item = workspace.sourceCollections.find((candidate) => candidate.id === id);
          return item
            ? [
                {
                  id: item.id,
                  name: item.name,
                  detail: `${item.sources.filter((source) => source.enabled).length} 个动态来源`,
                },
              ]
            : [];
        })}
        available={enabledSources
          .filter((item) => !form.sourceCollectionIds.includes(item.id))
          .map((item) => ({
            id: item.id,
            name: item.name,
            detail: `${item.sources.filter((source) => source.enabled).length} 个动态来源`,
          }))}
        empty="还没有添加输入来源"
        addLabel="添加来源集合"
        onAdd={(id) => update({ ...form, sourceCollectionIds: [...form.sourceCollectionIds, id] })}
        onRemove={(id) =>
          update({
            ...form,
            sourceCollectionIds: form.sourceCollectionIds.filter((item) => item !== id),
          })
        }
      />
    );
  }
  if (section === "publishing") {
    return (
      <div className="grid gap-4">
        <PublicationDestinationPicker
          accounts={workspace.channelAccounts}
          channels={workspace.channelDefinitions}
          profiles={workspace.publicationTypeProfiles}
          value={form.publishing.destinations}
          onChange={(destinations) => update({ ...form, publishing: { destinations } })}
        />
        {!form.publishing.destinations.length ? (
          <p className="text-sm text-[var(--muted-strong)]">
            未选择发布账号：运行后仅生成可发布内容包，不经过额外审核门禁。
          </p>
        ) : (
          <p className="text-xs leading-5 text-[var(--muted-strong)]">
            每个账号与发布类型会独立格式化、上传和发布；单个失败不会中断其他目的地。
          </p>
        )}
      </div>
    );
  }
  return null;
}

function sectionComplete(section: SectionId, form: SaveContentPlanPayload): boolean {
  if (section === "basic") return Boolean(form.name.trim() && form.agent?.modelConnectionId);
  if (section === "identity") return Boolean(form.identityId);
  if (section === "publishing") return true;
  return true;
}

function resolvedAgent(form: SaveContentPlanPayload): NonNullable<SaveContentPlanPayload["agent"]> {
  return (
    form.agent ?? {
      modelConnectionId: form.connections.chat ?? "",
      strategyId: form.templateId ?? "daily-brief",
      toolConnectionIds: [
        ...(form.researchConnections?.search ?? []),
        ...(form.researchConnections?.fetch ?? []),
        ...(form.connections.image ? [form.connections.image] : []),
      ].filter((id, index, values) => values.indexOf(id) === index),
      enhancementToolIds: [],
    }
  );
}

export function capabilityConnections(workspace: WorkspaceSnapshot, capability: string) {
  const definitions = new Map(workspace.connectorDefinitions.map((item) => [item.id, item]));
  return workspace.connections.filter(
    (connection) =>
      connection.enabled &&
      definitions.get(connection.connectorId)?.capabilities.includes(capability),
  );
}
