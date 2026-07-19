import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";

export function SettingsPage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  return (
    <PageGrid>
      <EntityList
        title="已注册扩展"
        description="扩展注册是代码级能力；运行参数由内容方案和连接保存。"
      >
        {workspace?.articleExtensions.plugins.map((item) => (
          <EntityRow
            key={item.id}
            title={item.name}
            description={item.optional ? "可按预设启用" : "默认质量能力"}
            status="ready"
            meta={<Badge>plugin</Badge>}
          />
        ))}
        {workspace?.channelDefinitions.map((item) => (
          <EntityRow
            key={item.id}
            title={item.name}
            description={`需要 ${item.requiredCapability} 连接能力`}
            status="ready"
            meta={<Badge>channel</Badge>}
          />
        ))}
      </EntityList>
    </PageGrid>
  );
}
