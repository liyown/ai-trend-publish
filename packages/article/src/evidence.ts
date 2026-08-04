import type { EvidenceUnit, MaterialSnapshot } from "./domain.ts";

export const EvidenceDiagnosticCode = {
  CitationMissing: "evidence.citation_missing",
  LocatorInvalid: "evidence.locator_invalid",
  LocatorMismatch: "evidence.locator_mismatch",
} as const;

export interface EvidenceLocatorIssue {
  code:
    | typeof EvidenceDiagnosticCode.LocatorInvalid
    | typeof EvidenceDiagnosticCode.LocatorMismatch;
  message: string;
}

/** Keeps only uniquely identified material and evidence that can safely enter a frozen package. */
export function selectPublishableEvidence(
  materials: MaterialSnapshot[],
  evidence: EvidenceUnit[],
): { materials: MaterialSnapshot[]; evidence: EvidenceUnit[] } {
  const materialCounts = occurrenceCounts(materials);
  const publishableMaterials = materials.filter(
    (material) => material.id.trim() && materialCounts.get(material.id) === 1,
  );
  const materialById = new Map(publishableMaterials.map((material) => [material.id, material]));
  const evidenceCounts = occurrenceCounts(evidence);
  const publishableEvidence = evidence.filter((item) => {
    const material = materialById.get(item.materialId);
    return Boolean(
      item.id.trim() &&
      evidenceCounts.get(item.id) === 1 &&
      item.statement.trim() &&
      material &&
      evidenceLocatorIssues(item, material).length === 0,
    );
  });
  return {
    materials: structuredClone(publishableMaterials),
    evidence: structuredClone(publishableEvidence),
  };
}

/** Validates that an evidence locator is usable and agrees with its captured material. */
export function evidenceLocatorIssues(
  evidence: EvidenceUnit,
  material?: MaterialSnapshot,
): EvidenceLocatorIssue[] {
  const issues: EvidenceLocatorIssue[] = [];
  const invalid = (message: string): void => {
    issues.push({ code: EvidenceDiagnosticCode.LocatorInvalid, message });
  };
  const mismatch = (message: string): void => {
    issues.push({ code: EvidenceDiagnosticCode.LocatorMismatch, message });
  };

  switch (evidence.locator.type) {
    case "text": {
      const excerpt = evidence.locator.excerpt;
      if (!excerpt.trim()) {
        invalid(`证据 ${evidence.id} 的文本定位缺少摘录`);
        break;
      }
      const searchableText = [material?.content, material?.transcript].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (searchableText.length && !searchableText.some((value) => value.includes(excerpt))) {
        mismatch(`证据 ${evidence.id} 的文本摘录不在素材 ${evidence.materialId} 中`);
      }
      break;
    }
    case "time-range": {
      const { startMs, endMs, transcript } = evidence.locator;
      if (!Number.isFinite(startMs) || startMs < 0) {
        invalid(`证据 ${evidence.id} 的时间起点必须是非负有限数`);
      }
      if (endMs !== undefined && (!Number.isFinite(endMs) || endMs < startMs)) {
        invalid(`证据 ${evidence.id} 的时间终点必须是有限数且不早于起点`);
      }
      if (transcript !== undefined) {
        if (!transcript.trim()) {
          invalid(`证据 ${evidence.id} 的时间定位包含空转录摘录`);
        } else if (material?.transcript && !material.transcript.includes(transcript)) {
          mismatch(`证据 ${evidence.id} 的转录摘录不在素材 ${evidence.materialId} 中`);
        }
      }
      break;
    }
    case "page": {
      const { page, excerpt } = evidence.locator;
      if (!Number.isInteger(page) || page < 1) {
        invalid(`证据 ${evidence.id} 的页码必须是正整数`);
      }
      if (excerpt !== undefined) {
        if (!excerpt.trim()) {
          invalid(`证据 ${evidence.id} 的页码定位包含空摘录`);
        } else if (material?.content && !material.content.includes(excerpt)) {
          mismatch(`证据 ${evidence.id} 的页面摘录不在素材 ${evidence.materialId} 中`);
        }
      }
      break;
    }
  }
  return issues;
}

function occurrenceCounts(values: Array<{ id: string }>): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value.id, (result.get(value.id) ?? 0) + 1);
  return result;
}
