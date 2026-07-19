import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsPage } from "../../features/connections/page.tsx";
export const Route = createFileRoute("/_app/connections")({ component: ConnectionsPage });
