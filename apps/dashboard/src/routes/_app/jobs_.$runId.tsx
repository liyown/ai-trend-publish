import { createFileRoute } from "@tanstack/react-router";
import { PageGrid } from "#components/product/page-grid.tsx";
import { RunDetailView } from "./jobs/-run-detail-view.tsx";

export const Route = createFileRoute("/_app/jobs_/$runId")({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runId } = Route.useParams();
  return (
    <PageGrid>
      <RunDetailView runId={runId} />
    </PageGrid>
  );
}
