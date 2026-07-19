import { createFileRoute } from "@tanstack/react-router";
import { PublishingPage } from "../features/publishing/page.tsx";
export const Route = createFileRoute("/_app/publishing")({ component: PublishingPage });
