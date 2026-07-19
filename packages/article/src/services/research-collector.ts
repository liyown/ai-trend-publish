import { describeUnknown } from "@trendpublish/runtime";
import type { MaterialSnapshot } from "../domain.ts";
import type {
  ArticleOperationContext,
  ResearchCandidate,
  ResearchFetchTool,
  ResearchSearchTool,
  ResearchSource,
  ResearchTool,
} from "../extensions.ts";

export interface ResearchInstruction {
  source: ResearchSource;
  seedId?: string;
}

export interface ResearchCollection {
  materials: MaterialSnapshot[];
  failures: string[];
}

export interface ResearchCollectorOptions {
  tools?: ResearchTool[];
  maxMaterials?: number;
  maxCandidatesPerQuery?: number;
}

/** Shared discovery -> fetch pipeline. Search snippets never become materials. */
export class ResearchCollector {
  constructor(private readonly options: ResearchCollectorOptions) {}

  async collect(
    instructions: ResearchInstruction[],
    initialMaterials: MaterialSnapshot[],
    context: ArticleOperationContext,
  ): Promise<ResearchCollection> {
    const materials = [...initialMaterials];
    const failures: string[] = [];
    const seenCandidateUrls = new Set<string>();

    for (const [index, instruction] of instructions.entries()) {
      if (instruction.source.type === "url") {
        await this.fetchInstruction(instruction, index, materials, failures, context);
        continue;
      }
      const searchTools = this.searchTools();
      if (!searchTools.length) {
        failures.push(this.unavailableMessage(instruction, "搜索"));
        continue;
      }
      const query = instruction.source.query;
      const searchResults = await Promise.allSettled(
        searchTools.map((searchTool) =>
          context.task.run(
            {
              id: `search/${index + 1}-${searchTool.id}`,
              version: searchTool.version,
              input: { toolId: searchTool.id, query },
            },
            (signal) =>
              searchTool.search(query, {
                task: context.task.scope(`search/${index + 1}-${searchTool.id}/internal`),
                signal,
                now: context.now,
              }),
          ),
        ),
      );
      const candidates: ResearchCandidate[] = [];
      for (const [toolIndex, result] of searchResults.entries()) {
        if (result.status === "fulfilled") candidates.push(...result.value);
        else
          failures.push(
            `来源 ${instructionLabel(instruction)}，搜索连接 ${searchTools[toolIndex]!.id}：${describeUnknown(result.reason)}`,
          );
      }

      const uniqueCandidates = candidates
        .filter((candidate) => {
          if (!candidate.url?.trim() || seenCandidateUrls.has(candidate.url)) return false;
          seenCandidateUrls.add(candidate.url);
          return true;
        })
        .slice(0, this.options.maxCandidatesPerQuery ?? 5);
      for (const [candidateIndex, candidate] of uniqueCandidates.entries()) {
        const fetchTools = this.fetchTools();
        if (!fetchTools.length) {
          failures.push(`搜索结果 ${candidate.url}：没有可用网页抓取工具`);
          continue;
        }
        const fetchFailures: string[] = [];
        let fetchedCandidate = false;
        for (const [fetchIndex, fetchTool] of fetchTools.entries()) {
          try {
            const fetched = await context.task.run(
              {
                id: `fetch/${index + 1}-${candidateIndex + 1}-${fetchIndex + 1}-${fetchTool.id}`,
                version: fetchTool.version,
                input: { toolId: fetchTool.id, candidate },
              },
              (signal) =>
                fetchTool.fetch(candidate.url, {
                  task: context.task.scope(
                    `fetch/${index + 1}-${candidateIndex + 1}-${fetchIndex + 1}-${fetchTool.id}/internal`,
                  ),
                  signal,
                  now: context.now,
                }),
            );
            if (!fetched.length) continue;
            materials.push(...fetched);
            fetchedCandidate = true;
            break;
          } catch (error) {
            fetchFailures.push(`${fetchTool.id}: ${describeUnknown(error)}`);
          }
        }
        if (!fetchedCandidate) {
          failures.push(
            `搜索结果 ${candidate.url}：${fetchFailures.length ? fetchFailures.join("；") : "抓取连接未返回正文"}`,
          );
        }
      }
    }

    return {
      materials: deduplicateMaterials(materials).slice(0, this.options.maxMaterials ?? 20),
      failures,
    };
  }

  private async fetchInstruction(
    instruction: ResearchInstruction,
    index: number,
    materials: MaterialSnapshot[],
    failures: string[],
    context: ArticleOperationContext,
  ): Promise<void> {
    if (instruction.source.type !== "url") return;
    const url = instruction.source.url;
    const tools = this.fetchTools();
    if (!tools.length) {
      failures.push(this.unavailableMessage(instruction, "网页抓取"));
      return;
    }
    const fetchFailures: string[] = [];
    for (const tool of tools) {
      try {
        const fetched = await context.task.run(
          {
            id: `fetch/${index + 1}-${tool.id}`,
            version: tool.version,
            input: { toolId: tool.id, url },
          },
          (signal) =>
            tool.fetch(url, {
              task: context.task.scope(`fetch/${index + 1}-${tool.id}/internal`),
              signal,
              now: context.now,
            }),
        );
        if (!fetched.length) continue;
        materials.push(...fetched);
        return;
      } catch (error) {
        fetchFailures.push(`${tool.id}: ${describeUnknown(error)}`);
      }
    }
    failures.push(
      `来源 ${instructionLabel(instruction)}：${fetchFailures.length ? fetchFailures.join("；") : "抓取连接未返回正文"}`,
    );
  }

  private searchTools(): ResearchSearchTool[] {
    return (this.options.tools ?? []).filter(
      (tool): tool is ResearchSearchTool => tool.capability === "search",
    );
  }

  private fetchTools(): ResearchFetchTool[] {
    return (this.options.tools ?? []).filter(
      (tool): tool is ResearchFetchTool => tool.capability === "fetch",
    );
  }

  private unavailableMessage(instruction: ResearchInstruction, capability: string): string {
    return `来源 ${instructionLabel(instruction)}：没有可用${capability}工具`;
  }
}

export function deduplicateMaterials(materials: MaterialSnapshot[]): MaterialSnapshot[] {
  const result = new Map<string, MaterialSnapshot>();
  for (const material of materials) {
    const key = material.sourceUrl?.trim() || material.contentHash?.trim() || material.id;
    if (!key || !material.id?.trim() || !material.contentHash?.trim()) continue;
    if (!result.has(key)) result.set(key, structuredClone(material));
  }
  return [...result.values()];
}

function instructionLabel(instruction: ResearchInstruction): string {
  if (instruction.seedId) return instruction.seedId;
  return instruction.source.type === "url" ? instruction.source.url : instruction.source.query;
}
