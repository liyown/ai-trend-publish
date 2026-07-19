import { createFileRoute } from "@tanstack/react-router";
import { ContentPlanEditorPage } from "../features/content-plans/editor-page.tsx";
export const Route = createFileRoute("/_app/content-plans/$planId/edit")({
  component: ContentPlanEditorPage,
});
