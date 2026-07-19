import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "../features/library/page.tsx";
export const Route = createFileRoute("/_app/library")({ component: LibraryPage });
