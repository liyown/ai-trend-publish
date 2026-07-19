import { ArticlePluginId, DiagnosticSeverity } from "@trendpublish/contracts";
import { Trash2 } from "lucide-react";
import type {
  ArticlePluginSelection,
  JsonValue,
  SaveContentPlanPayload,
  WorkspaceSnapshot,
} from "#platform/api/types.ts";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { NativeSelect } from "#components/ui/select.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { splitLines } from "../common.tsx";

export function PluginSettings({
  pluginId,
  onPluginChange,
  definitions,
  form,
  update,
  imageConnections,
  coverRequired,
}: {
  pluginId: string | null;
  onPluginChange(value: string | null): void;
  definitions: WorkspaceSnapshot["articleExtensions"]["plugins"];
  form: SaveContentPlanPayload;
  update(value: SaveContentPlanPayload): void;
  imageConnections: Array<{ id: string; name: string }>;
  coverRequired: boolean;
}) {
  const plugin = form.plugins.find((item) => item.pluginId === pluginId);
  const definition = definitions.find((item) => item.id === pluginId);

  if (!plugin || !definition)
    return (
      <EmptyState
        className="min-h-64 border-y border-[var(--border)]"
        title="还没有添加插件"
        description="从左侧“添加插件”选择需要的处理能力；内容方案也可以不使用插件。"
      />
    );

  const setPlugin = (value: ArticlePluginSelection) =>
    update({
      ...form,
      plugins: form.plugins.map((item) => (item.pluginId === value.pluginId ? value : item)),
    });
  const removePlugin = () => {
    const remaining = form.plugins.filter((item) => item.pluginId !== plugin.pluginId);
    const connections = { ...form.connections };
    if (plugin.pluginId === ArticlePluginId.CoverImage) delete connections.image;
    update({ ...form, plugins: remaining, connections });
    onPluginChange(remaining[0]?.pluginId ?? null);
  };
  const config = record(plugin.config);

  return (
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-5 border-b border-[var(--border)] pb-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-[-0.01em]">{definition.name}</h3>
          <p className="mt-1 text-sm leading-5 text-[var(--muted-strong)]">
            {definition.description}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          disabled={coverRequired && plugin.pluginId === ArticlePluginId.CoverImage}
          onClick={removePlugin}
        >
          <Trash2 className="size-3.5" />
          {coverRequired && plugin.pluginId === ArticlePluginId.CoverImage
            ? "发布目标需要"
            : "移除插件"}
        </Button>
      </div>

      {plugin.pluginId === ArticlePluginId.TitleStyle ? (
        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="标题规则" helper="每行一条" className="md:col-span-2">
            <Textarea
              className="min-h-32"
              value={arrayText(config.rules)}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, rules: splitLines(event.target.value) } as JsonValue,
                })
              }
              placeholder={"强调可执行判断\n避免泛泛速递和夸张词"}
            />
          </FormField>
          <FormField label="最短标题长度">
            <Input
              type="number"
              min={1}
              max={200}
              value={typeof config.minLength === "number" ? config.minLength : 8}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, minLength: Number(event.target.value) } as JsonValue,
                })
              }
            />
          </FormField>
          <FormField label="最长标题长度">
            <Input
              type="number"
              min={1}
              max={200}
              value={typeof config.maxLength === "number" ? config.maxLength : 40}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, maxLength: Number(event.target.value) } as JsonValue,
                })
              }
            />
          </FormField>
        </div>
      ) : null}

      {plugin.pluginId === ArticlePluginId.EditorialQuality ? (
        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="质量标准" helper="每行一条" className="md:col-span-2">
            <Textarea
              className="min-h-32"
              value={arrayText(config.standards)}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, standards: splitLines(event.target.value) } as JsonValue,
                })
              }
              placeholder={"结论有事实依据\n说明限制、成本和适用范围"}
            />
          </FormField>
          <FormField label="问题等级">
            <NativeSelect
              value={
                typeof config.severity === "string" ? config.severity : DiagnosticSeverity.Error
              }
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, severity: event.target.value } as JsonValue,
                })
              }
            >
              <option value={DiagnosticSeverity.Warning}>警告</option>
              <option value={DiagnosticSeverity.Error}>阻止通过</option>
            </NativeSelect>
          </FormField>
          <FormField
            label="最大质量保证轮数"
            helper="每轮依次评估、按需补证并修订；达到上限后仍未通过则转人工审查。"
          >
            <Input
              type="number"
              min={0}
              max={5}
              value={typeof config.maxQualityRounds === "number" ? config.maxQualityRounds : 2}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: {
                    ...config,
                    maxQualityRounds: Number(event.target.value),
                  } as JsonValue,
                })
              }
            />
          </FormField>
        </div>
      ) : null}

      {plugin.pluginId === ArticlePluginId.EvidenceSupplement ? (
        <p className="border-y border-[var(--border)] py-8 text-sm leading-6 text-[var(--muted-strong)]">
          此插件复用内容方案现有的搜索与网页读取来源。评估器提出证据需求后，它会在同一质量保证轮次内补充材料，再交给文章修订器处理。
        </p>
      ) : null}

      {plugin.pluginId === ArticlePluginId.CoverImage ? (
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            label="图片连接"
            helper={
              coverRequired
                ? "已选微信公众号目标，必须选择图片连接。"
                : "留空时，必要型请求会进入人工审查。"
            }
            required={coverRequired}
          >
            <NativeSelect
              value={form.connections.image ?? ""}
              onChange={(event) =>
                update({
                  ...form,
                  connections: { ...form.connections, image: event.target.value },
                })
              }
            >
              <option value="">请选择</option>
              {imageConnections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="封面风格">
            <Input
              value={typeof config.style === "string" ? config.style : ""}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, style: event.target.value } as JsonValue,
                })
              }
              placeholder="例如：信息图、干净留白"
            />
          </FormField>
          <FormField
            label="资源必要性"
            helper={
              coverRequired
                ? "微信公众号要求封面，已固定为必要型。"
                : "增强型失败时省略封面；必要型失败时转入人工审查。"
            }
            className="md:col-span-2"
          >
            <NativeSelect
              value={config.necessity === "enhancement" ? "enhancement" : "essential"}
              disabled={coverRequired}
              onChange={(event) =>
                setPlugin({
                  ...plugin,
                  config: { ...config, necessity: event.target.value } as JsonValue,
                })
              }
            >
              <option value="enhancement">增强型（失败时省略）</option>
              <option value="essential">必要型（失败时转审查）</option>
            </NativeSelect>
          </FormField>
        </div>
      ) : null}

      {!Object.values(ArticlePluginId).includes(plugin.pluginId as ArticlePluginId) ? (
        <p className="border-y border-[var(--border)] py-8 text-sm text-[var(--muted)]">
          此插件没有需要手动配置的字段。
        </p>
      ) : null}
    </div>
  );
}

export function defaultPluginSelection(pluginId: string): ArticlePluginSelection {
  if (pluginId === ArticlePluginId.TitleStyle)
    return { pluginId, enabled: true, config: { rules: [], minLength: 8, maxLength: 40 } };
  if (pluginId === ArticlePluginId.EditorialQuality) {
    return {
      pluginId,
      enabled: true,
      config: { standards: [], severity: DiagnosticSeverity.Error, maxQualityRounds: 2 },
    };
  }
  if (pluginId === ArticlePluginId.CoverImage) {
    return { pluginId, enabled: true, config: { style: "", necessity: "essential" } };
  }
  return { pluginId, enabled: true };
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayText(value: JsonValue | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n")
    : "";
}
