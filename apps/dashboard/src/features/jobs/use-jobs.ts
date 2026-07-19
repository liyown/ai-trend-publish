import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listJobs, resumeJob } from "#platform/api/jobs.ts";
import type { JobRecord } from "#platform/api/types.ts";

export const jobsKey = () => ["jobs"] as const;
export const jobKey = (id: string) => ["jobs", id] as const;

export function useJobs() {
  return useQuery({ queryKey: jobsKey(), queryFn: listJobs });
}

export function useResumeJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (job: Pick<JobRecord, "id" | "type">) => resumeJob(job),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobsKey() }),
  });
}
