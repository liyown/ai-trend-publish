import { createFileRoute } from "@tanstack/react-router";
import { ContentPlansPage } from "../../features/content-plans/page.tsx";
export const Route = createFileRoute("/_app/content-plans")({ component: ContentPlansPage });
