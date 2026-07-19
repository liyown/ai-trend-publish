import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../features/landing/page.tsx";
export const Route = createFileRoute("/")({ component: LandingPage });
