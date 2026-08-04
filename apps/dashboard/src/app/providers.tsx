import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth.tsx";
import { TooltipProvider } from "../components/ui/tooltip.tsx";
import { shouldRetryDashboardQuery } from "../platform/api/query-retry.ts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryDashboardQuery,
      refetchOnWindowFocus: false,
      staleTime: 20_000,
    },
  },
});

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300} skipDelayDuration={100}>
        <AuthProvider>{children}</AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
