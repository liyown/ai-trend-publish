import { createFileRoute } from "@tanstack/react-router";
import { KnowledgePage } from "../features/knowledge/page.tsx";
export const Route = createFileRoute("/_app/knowledge")({ component: KnowledgePage });
