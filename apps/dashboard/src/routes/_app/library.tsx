import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "./-library.tsx";
export const Route = createFileRoute("/_app/library")({ component: LibraryPage });
