import { createFileRoute } from "@tanstack/react-router";
import { IdentitiesPage } from "../features/identities/page.tsx";
export const Route = createFileRoute("/_app/identities")({ component: IdentitiesPage });
