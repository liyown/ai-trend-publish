import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "../features/sources/page.tsx";
export const Route = createFileRoute("/_app/sources")({ component: SourcesPage });
