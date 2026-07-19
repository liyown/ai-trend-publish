import type { SaveContentPlanPayload, WorkspaceSnapshot } from "#platform/api/types.ts";

const stages = [
  ["准备", "加载方案、身份与运行配置"],
  ["研究简报", "形成主题、证据与文章结构"],
  ["写作 Source", "生成可编辑的 Markdown Source"],
  ["Transformer", "按配置顺序加工 Source"],
  ["评估/集中修订", "统一诊断，并在同一轮内按需补证和修订"],
  ["AssetProvider", "生成 Source 声明的内容资源"],
  ["编译/构建", "编译 AST 并冻结 ContentPackage"],
] as const;

export function PipelineOverview({
  form,
  definitions,
}: {
  form: SaveContentPlanPayload;
  definitions: WorkspaceSnapshot["articleExtensions"]["plugins"];
}) {
  const plugins = form.plugins
    .filter((item) => item.enabled)
    .map((item) => {
      const definition = definitions.find((value) => value.id === item.pluginId);
      return {
        id: item.pluginId,
        name: definition?.name ?? item.pluginId,
        stage: pluginStages(definition?.capabilities ?? []),
      };
    });

  return (
    <section className="border-y border-[var(--border)] py-4 md:col-span-2">
      <div>
        <h4 className="text-sm font-semibold">固定生成流程</h4>
        <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
          内容统一经过以下阶段；身份、参考输入和插件只改变各阶段使用的上下文与扩展能力。
        </p>
      </div>
      <ol
        className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]"
        aria-label="内容生成流程"
      >
        {stages.map(([name, detail], index) => (
          <li
            key={name}
            className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[2rem_10rem_minmax(0,1fr)] sm:items-baseline"
          >
            <span className="text-[10px] font-medium tabular-nums text-[var(--muted)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <strong className="text-xs font-semibold">{name}</strong>
            <span className="col-start-2 text-[11px] leading-4 text-[var(--muted)] sm:col-start-auto">
              {detail}
            </span>
          </li>
        ))}
      </ol>
      {plugins.length ? (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-[var(--border)] pt-3 text-xs">
          {plugins.map((plugin) => (
            <span key={plugin.id} className="text-[var(--muted-strong)]">
              <strong className="font-medium text-[var(--ink)]">{plugin.name}</strong>
              <span className="ml-1.5">{plugin.stage}</span>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function pluginStages(
  capabilities: WorkspaceSnapshot["articleExtensions"]["plugins"][number]["capabilities"],
): string {
  const stages = capabilities.map((capability) => {
    if (capability === "evaluator") return "评估/集中修订";
    if (capability === "evidence-supplementer") return "评估/集中修订";
    if (capability === "asset-provider") return "AssetProvider";
    return "Transformer";
  });
  return [...new Set(stages)].join("、") || "扩展阶段";
}
