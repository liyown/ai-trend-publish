import { createFileRoute } from "@tanstack/react-router";
import { ContentPlanEditorPage } from "./content-plans/-editor-page.tsx";
export const Route = createFileRoute("/_app/content-plans_/new")({
  component: ContentPlanEditorPage,
});
