export function dashboardQueryKeys(apiKey: string) {
  return {
    root: ["workspace", apiKey] as const,
    snapshot: ["workspace", apiKey, "snapshot"] as const,
    job: (jobId: string | null) => ["workspace", apiKey, "job", jobId] as const,
  };
}
