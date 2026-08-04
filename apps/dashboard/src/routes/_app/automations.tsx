import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPage } from "./-automations.tsx";

export const Route = createFileRoute("/_app/automations")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Number(search["page"] ?? 1) || 1,
  }),
  component: AutomationsRoute,
});

function AutomationsRoute() {
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AutomationsPage
      page={page}
      onPageChange={(p) => navigate({ search: (previous) => ({ ...previous, page: p }) })}
    />
  );
}
