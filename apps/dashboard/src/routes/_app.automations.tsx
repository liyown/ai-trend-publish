import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPage } from "../features/automations/page.tsx";
export const Route = createFileRoute("/_app/automations")({ component: AutomationsPage });
