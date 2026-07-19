import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { DashboardProviders } from "./providers.tsx";
import { router } from "./router.tsx";
import "../styles.css";

export function bootstrapDashboard() {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <DashboardProviders>
        <RouterProvider router={router} />
      </DashboardProviders>
    </React.StrictMode>,
  );
}
