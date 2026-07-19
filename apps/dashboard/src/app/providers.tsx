import React, { createContext, useContext, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth.tsx";
import { httpDashboardApi } from "../platform/api/http-dashboard-api.ts";
import type { DashboardApi } from "../platform/api/dashboard-api.ts";
import { shouldRetryDashboardQuery } from "../platform/api/query-retry.ts";
import { TooltipProvider } from "../components/ui/tooltip.tsx";

const ApiContext = createContext<DashboardApi | null>(null);

export function useDashboardApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useDashboardApi must be used inside providers");
  return api;
}

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  const dashboardApi = httpDashboardApi;
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: shouldRetryDashboardQuery,
            refetchOnWindowFocus: false,
            staleTime: 20_000,
          },
        },
      }),
    [],
  );

  return (
    <ApiContext.Provider value={dashboardApi}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300} skipDelayDuration={100}>
          <AuthProvider>{children}</AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
