import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "./-landing.tsx";
export const Route = createFileRoute("/")({ component: LandingPage });
