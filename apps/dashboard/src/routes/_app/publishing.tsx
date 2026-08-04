import { createFileRoute } from "@tanstack/react-router";
import { PublishingPage } from "./-publishing.tsx";
export const Route = createFileRoute("/_app/publishing")({ component: PublishingPage });
