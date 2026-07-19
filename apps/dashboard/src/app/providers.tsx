import React, { createContext, useContext, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth.tsx";
import { createHttpDashboardApi } from "../platform/api/http-dashboard-api.ts";
import type { DashboardApi } from "../platform/api/dashboard-api.ts";
import { shouldRetryDashboardQuery } from "../platform/api/query-retry.ts";
import { TooltipProvider } from "../components/ui/tooltip.tsx";

const ApiContext = createContext<DashboardApi | null>(null);

export function useDashboardApi() {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useDashboardApi must be used inside providers");
  return api;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryDashboardQuery,
      refetchOnWindowFocus: false,
      staleTime: 20_000,
    },
  },
});

function ApiProvider({ children }: { children: React.ReactNode }) {
  const { apiKey } = useAuth();
  const api = useMemo(() => createHttpDashboardApi(apiKey), [apiKey]);
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300} skipDelayDuration={100}>
        <AuthProvider>
          <ApiProvider>{children}</ApiProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
