import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsPage } from "./-connections.tsx";
export const Route = createFileRoute("/_app/connections")({ component: ConnectionsPage });
