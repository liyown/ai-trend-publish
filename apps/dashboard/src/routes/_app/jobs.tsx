import { createFileRoute } from "@tanstack/react-router";
import { JobsPage } from "../../features/jobs/page.tsx";
export const Route = createFileRoute("/_app/jobs")({ component: JobsPage });
