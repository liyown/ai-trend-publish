import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { DashboardProviders } from "./providers.tsx";
import { routeTree } from "../routeTree.gen.ts";
import "../styles.css";

const router = createRouter({ routeTree, basepath: "/dashboard/", defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function bootstrapDashboard() {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <DashboardProviders>
        <RouterProvider router={router} />
      </DashboardProviders>
    </React.StrictMode>,
  );
}
