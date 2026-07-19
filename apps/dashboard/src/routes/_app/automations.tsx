import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPage } from "./-automations.tsx";
export const Route = createFileRoute("/_app/automations")({ component: AutomationsPage });
