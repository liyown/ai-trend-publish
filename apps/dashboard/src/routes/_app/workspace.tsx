import { createFileRoute } from "@tanstack/react-router";
import { WorkspacePage } from "../../features/workspace/page.tsx";
export const Route = createFileRoute("/_app/workspace")({ component: WorkspacePage });
