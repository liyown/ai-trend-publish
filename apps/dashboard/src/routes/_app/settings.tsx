import { createFileRoute } from "@tanstack/react-router";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";

export const Route = createFileRoute("/_app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { data: workspace } = useWorkspaceSnapshot({ live: false });
  return (
    <PageGrid>
      <EntityList
        title="内置模板与渠道"
        description="只读展示当前真正可用的模板、渠道和发布类型；内部提示词与 Schema 不对外暴露。"
      >
        {workspace?.contentPlanTemplates.map((item) => (
          <EntityRow
            key={item.id}
            title={item.name}
            description={`${item.description} · ${item.stages.join(" → ")}`}
            status="ready"
            meta={<Badge>template</Badge>}
          />
        ))}
        {workspace?.channelDefinitions.map((item) => (
          <EntityRow
            key={item.id}
            title={item.name}
            description={`${item.description} · ${workspace.publicationTypeProfiles
              .filter((profile) => profile.channel === item.id)
              .map((profile) => profile.name)
              .join(" / ")}`}
            status="ready"
            meta={<Badge>channel</Badge>}
          />
        ))}
      </EntityList>
    </PageGrid>
  );
}
