import { useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  Circle,
  CircleCheck,
  Fingerprint,
  Globe2,
  Plus,
  Puzzle,
  RadioTower,
  Settings2,
} from "lucide-react";
import type { SaveContentPlanPayload, WorkspaceSnapshot } from "#platform/api/types.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#components/ui/dropdown-menu.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { cn } from "#lib/utils.ts";
import { FormError } from "#components/product/form-error.tsx";
import { AssociationList } from "./association-list.tsx";
import { PipelineOverview } from "./pipeline-overview.tsx";
import { defaultPluginSelection, PluginSettings } from "./plugin-settings.tsx";
import { isWeixinPublishTarget, requiresWeixinCover } from "./requirements.ts";

const sections = [
  ["basic", "基本设置", "名称与生成模型", Settings2],
  ["identity", "内容身份", "定位、受众和语气", Fingerprint],
  ["knowledge", "知识库", "长期参考材料", BookOpen],
  ["sources", "抓取数据源", "运行时动态输入", Globe2],
  ["plugins", "处理插件", "标题、质量和封面", Puzzle],
  ["publishing", "发布配置", "内容输出目标", RadioTower],
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
  const [pluginId, setPluginId] = useState<string | null>(form.plugins[0]?.pluginId ?? null);
  useEffect(() => {
    if (pluginId && form.plugins.some((item) => item.pluginId === pluginId)) return;
    setPluginId(form.plugins[0]?.pluginId ?? null);
  }, [form.plugins, pluginId]);
  const availablePlugins =
    workspace?.articleExtensions.plugins.filter(
      (definition) => !form.plugins.some((item) => item.pluginId === definition.id),
    ) ?? [];
  const addPlugin = (id: string) => {
    update({ ...form, plugins: [...form.plugins, defaultPluginSelection(id)] });
    setPluginId(id);
    onSectionChange("plugins");
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label="内容方案配置模块"
        className="min-w-0 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2 lg:sticky lg:top-4 lg:self-start"
      >
        <div className="flex gap-1 overflow-x-auto lg:grid lg:overflow-visible">
          {sections.map(([id, title, detail, Icon]) => {
            const complete = sectionComplete(id, form);
            return (
              <div key={id} className="min-w-[164px] lg:min-w-0">
                <button
                  type="button"
                  aria-expanded={id === "plugins" ? section === "plugins" : undefined}
                  onClick={() => {
                    onSectionChange(id);
                    if (id === "plugins" && !pluginId)
                      setPluginId(form.plugins[0]?.pluginId ?? null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-3 text-left transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                    section === id
                      ? "bg-[var(--surface-2)] text-[var(--ink)]"
                      : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  <span className="grid size-6 shrink-0 place-items-center text-[var(--muted-strong)]">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <strong className="block truncate text-sm font-semibold">{title}</strong>
                      {id === "plugins" ? (
                        <ChevronDown
                          className={cn(
                            "size-3.5 shrink-0 text-[var(--muted)] transition-transform duration-[var(--motion-base)]",
                            section !== "plugins" && "-rotate-90",
                          )}
                        />
                      ) : null}
                      {complete ? (
                        <CircleCheck className="size-3.5 shrink-0 text-[var(--success)]" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
                      {detail}
                    </span>
                  </span>
                </button>
                {id === "plugins" && section === "plugins" ? (
                  <div className="mt-1 grid gap-0.5 border-l border-[var(--border)] pl-3 lg:ml-5">
                    {form.plugins.map((selection) => {
                      const definition = workspace?.articleExtensions.plugins.find(
                        (item) => item.id === selection.pluginId,
                      );
                      return (
                        <button
                          key={selection.pluginId}
                          type="button"
                          onClick={() => setPluginId(selection.pluginId)}
                          className={cn(
                            "truncate rounded-[var(--radius-xs)] px-2 py-2 text-left text-xs transition-colors duration-[var(--motion-fast)]",
                            pluginId === selection.pluginId
                              ? "bg-[var(--surface-3)] font-semibold text-[var(--ink)]"
                              : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)]",
                          )}
                        >
                          {definition?.name ?? selection.pluginId}
                        </button>
                      );
                    })}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="mt-1 w-full justify-start"
                          size="sm"
                          variant="ghost"
                          disabled={!availablePlugins.length}
                        >
                          <Plus className="size-3.5" />
                          添加插件
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-48">
                        {availablePlugins.map((definition) => (
                          <DropdownMenuItem
                            key={definition.id}
                            onSelect={() => addPlugin(definition.id)}
                          >
                            {definition.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>
      <div className="min-h-[560px] min-w-0 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 lg:py-8">
          <SectionHeader
            section={section}
            pluginName={
              section === "plugins"
                ? workspace?.articleExtensions.plugins.find((item) => item.id === pluginId)?.name
                : undefined
            }
          />
          <div
            key={`${section}:${pluginId ?? "none"}`}
            className={cn("motion-page", section === "plugins" && pluginId ? "" : "mt-6")}
          >
            <SectionContent
              section={section}
              pluginId={pluginId}
              onPluginChange={setPluginId}
              form={form}
              update={update}
              workspace={workspace}
            />
          </div>
          <FormError error={error} />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ section, pluginName }: { section: SectionId; pluginName?: string }) {
  if (section === "plugins" && pluginName) return null;
  const item = sections.find(([id]) => id === section)!;
  const descriptions: Record<SectionId, string> = {
    basic: "设置方案名称和生成模型，并确认固定生成流程。",
    identity: "选择内容表达主体；身份只负责定位、受众、语气和边界。",
    knowledge: "选择已上传的长期参考材料，不会在运行时重新抓取。",
    sources: "选择动态来源，并决定搜索与网页抓取使用哪些连接。",
    plugins: "标题规则、质量标准和封面样式都由插件独立维护。",
    publishing: "选择只生成内容，或在质量通过后发布到指定目标。",
  };
  return (
    <header>
      <h3 className="text-xl font-semibold tracking-[-0.02em]">
        {section === "plugins" && pluginName ? pluginName : item[1]}
      </h3>
      <p className="mt-1.5 text-sm text-[var(--muted-strong)]">{descriptions[section]}</p>
    </header>
  );
}

function SectionContent({
  section,
  pluginId,
  onPluginChange,
  form,
  update,
  workspace,
}: {
  section: SectionId;
  pluginId: string | null;
  onPluginChange(value: string | null): void;
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
  if (section === "basic")
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
            value={form.connections.chat ?? ""}
            onChange={(event) =>
              update({ ...form, connections: { ...form.connections, chat: event.target.value } })
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
        <PipelineOverview form={form} definitions={workspace.articleExtensions.plugins} />
      </div>
    );
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
    if (!enabledSources.length)
      return (
        <EmptyState
          className="min-h-48 border-y border-[var(--border)]"
          title="还没有抓取数据源"
          description="添加运行时需要读取的网址或搜索来源；这一步也可以暂时跳过。"
          action={
            <Button size="sm" onClick={() => (window.location.href = "/dashboard/sources")}>
              新建抓取数据源
            </Button>
          }
        />
      );
    const research = form.researchConnections ?? { search: [], fetch: [] };
    const searchConnections = connections("source-search");
    const fetchConnections = connections("source-fetch");
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
    const moveFetch = (id: string, direction: -1 | 1) => {
      const fetch = [...research.fetch];
      const index = fetch.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= fetch.length) return;
      [fetch[index], fetch[target]] = [fetch[target]!, fetch[index]!];
      update({ ...form, researchConnections: { ...research, fetch } });
    };
    return (
      <div className="grid gap-7">
        <section className="grid gap-2">
          <h4 className="text-sm font-semibold">来源集合</h4>
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
            empty="还没有添加抓取数据源"
            addLabel="添加抓取数据源"
            onAdd={(id) =>
              update({ ...form, sourceCollectionIds: [...form.sourceCollectionIds, id] })
            }
            onRemove={(id) =>
              update({
                ...form,
                sourceCollectionIds: form.sourceCollectionIds.filter((item) => item !== id),
              })
            }
          />
        </section>
        <section className="grid gap-2 border-t border-[var(--border)] pt-5">
          <div>
            <h4 className="text-sm font-semibold">搜索连接</h4>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              已选连接会全部参与搜索并合并结果；不选择时自动使用一个可用连接。
            </p>
          </div>
          <AssociationList
            items={research.search.flatMap((id) => {
              const option = connectionOption(id);
              return option ? [option] : [];
            })}
            available={searchConnections
              .filter((item) => !research.search.includes(item.id))
              .map((item) => connectionOption(item.id)!)}
            empty="自动选择搜索连接"
            addLabel="添加搜索连接"
            onAdd={(id) =>
              update({
                ...form,
                researchConnections: { ...research, search: [...research.search, id] },
              })
            }
            onRemove={(id) =>
              update({
                ...form,
                researchConnections: {
                  ...research,
                  search: research.search.filter((item) => item !== id),
                },
              })
            }
          />
        </section>
        <section className="grid gap-2">
          <div>
            <h4 className="text-sm font-semibold">网页抓取连接</h4>
            <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
              按显示顺序尝试，获得正文后停止；不选择时自动使用一个可用连接。
            </p>
          </div>
          <AssociationList
            items={research.fetch.flatMap((id) => {
              const option = connectionOption(id);
              return option ? [option] : [];
            })}
            available={fetchConnections
              .filter((item) => !research.fetch.includes(item.id))
              .map((item) => connectionOption(item.id)!)}
            empty="自动选择网页抓取连接"
            addLabel="添加网页抓取连接"
            onAdd={(id) =>
              update({
                ...form,
                researchConnections: { ...research, fetch: [...research.fetch, id] },
              })
            }
            onRemove={(id) =>
              update({
                ...form,
                researchConnections: {
                  ...research,
                  fetch: research.fetch.filter((item) => item !== id),
                },
              })
            }
            onMove={moveFetch}
          />
        </section>
      </div>
    );
  }
  if (section === "plugins")
    return (
      <PluginSettings
        pluginId={pluginId}
        onPluginChange={onPluginChange}
        definitions={workspace.articleExtensions.plugins}
        form={form}
        update={update}
        imageConnections={connections("image")}
        coverRequired={requiresWeixinCover(form, workspace)}
      />
    );
  if (section === "publishing") {
    const targets = workspace.publishTargets;
    return (
      <div className="grid gap-6">
        <div className="grid gap-3 md:grid-cols-2">
          <ChoiceRow
            type="radio"
            checked={form.publishing.mode === "content_only"}
            onChange={() =>
              update({ ...form, publishing: { mode: "content_only", targetIds: [] } })
            }
            title="仅生成内容"
            detail="成品进入内容包，后续手动处理。"
          />
          <ChoiceRow
            type="radio"
            checked={form.publishing.mode === "publish"}
            onChange={() => update({ ...form, publishing: { mode: "publish", targetIds: [] } })}
            title="质量通过后发布"
            detail="运行完成后发布到选中的目标。"
          />
        </div>
        {form.publishing.mode === "publish" ? (
          <AssociationList
            items={form.publishing.targetIds.flatMap((id) => {
              const target = targets.find((candidate) => candidate.id === id);
              return target
                ? [
                    {
                      id: target.id,
                      name: target.name,
                      detail: isWeixinPublishTarget(target.id, workspace)
                        ? "微信公众号 · 需要必要封面"
                        : "内容发布目标",
                    },
                  ]
                : [];
            })}
            available={targets
              .filter((target) => !form.publishing.targetIds.includes(target.id))
              .map((target) => ({
                id: target.id,
                name: target.name,
                detail: isWeixinPublishTarget(target.id, workspace)
                  ? "微信公众号 · 将启用必要封面"
                  : "内容发布目标",
              }))}
            empty="还没有添加发布目标"
            addLabel="添加发布目标"
            onAdd={(id) =>
              update({
                ...form,
                publishing: {
                  ...form.publishing,
                  targetIds: [...form.publishing.targetIds, id],
                },
              })
            }
            onRemove={(id) =>
              update({
                ...form,
                publishing: {
                  ...form.publishing,
                  targetIds: form.publishing.targetIds.filter((item) => item !== id),
                },
              })
            }
          />
        ) : null}
      </div>
    );
  }
  return null;
}

function sectionComplete(section: SectionId, form: SaveContentPlanPayload): boolean {
  if (section === "basic") return Boolean(form.name.trim() && form.connections.chat);
  if (section === "identity") return Boolean(form.identityId);
  if (section === "plugins") return true;
  if (section === "publishing")
    return form.publishing.mode === "content_only" || Boolean(form.publishing.targetIds.length);
  return true;
}

function ChoiceRow({
  checked,
  onChange,
  title,
  detail,
  type = "checkbox",
}: {
  checked: boolean;
  onChange(): void;
  title: string;
  detail: string;
  type?: "checkbox" | "radio";
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-center justify-between gap-5 bg-[var(--surface)] px-4 py-3 transition-colors duration-[var(--motion-fast)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[var(--focus)]",
        !checked && "hover:bg-[var(--surface-2)]",
      )}
    >
      <input className="sr-only" type={type} checked={checked} onChange={onChange} />
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold text-[var(--ink)]">{title}</strong>
        <span className="mt-1 block text-xs leading-5 text-[var(--muted-strong)]">{detail}</span>
      </span>
      {type === "radio" ? (
        checked ? (
          <CircleCheck aria-hidden="true" className="size-[18px] shrink-0 text-[var(--success)]" />
        ) : (
          <Circle aria-hidden="true" className="size-[18px] shrink-0 text-[var(--muted)]" />
        )
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "grid size-[18px] shrink-0 place-items-center rounded-[4px] border text-[10px] leading-none transition-colors duration-[var(--motion-fast)]",
            checked
              ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]"
              : "border-[var(--border-strong)] bg-[var(--surface)]",
          )}
        >
          {checked ? "✓" : null}
        </span>
      )}
    </label>
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
