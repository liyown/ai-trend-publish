export function dashboardQueryKeys() {
  return {
    root: ["workspace"] as const,
    snapshot: ["workspace", "snapshot"] as const,
    job: (jobId: string | null) => ["workspace", "job", jobId] as const,
  };
}
