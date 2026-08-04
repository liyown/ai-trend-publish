import {
  reviseWorkspaceEntity,
  type WorkspaceDocumentKind,
  type WorkspaceDocumentMap,
  type WorkspaceRepository,
} from "@trendpublish/core/workspace";
import { HttpError } from "../middleware/errors.ts";

export async function updateWorkspaceDocument<K extends WorkspaceDocumentKind>(
  repository: WorkspaceRepository,
  kind: K,
  id: string,
  body: Record<string, any>,
): Promise<WorkspaceDocumentMap[K]> {
  const current = await repository.get(kind, id);
  if (!current) throw new HttpError("对象不存在", 404);
  if (body.revision !== undefined && body.revision !== current.revision) {
    throw new HttpError("对象已被其他操作更新，请刷新后重试", 409);
  }
  const next = reviseWorkspaceEntity(current, withoutRevision(body) as any);
  return await repository.save(kind, next);
}

export async function removeWorkspaceDocument(
  repository: WorkspaceRepository,
  kind: WorkspaceDocumentKind,
  id: string,
): Promise<void> {
  if (!(await repository.remove(kind, id))) throw new HttpError("对象不存在", 404);
}

export function withoutRevision<T extends Record<string, any>>(body: T): Omit<T, "revision"> {
  const { revision: _revision, ...value } = body;
  return value;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parsePage(query: Record<string, string | string[] | undefined>): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Number(firstQueryValue(query["page"])) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(firstQueryValue(query["pageSize"])) || 20));
  return { page, pageSize };
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function paginate<T>(all: T[], page: number, pageSize: number): PageResult<T> {
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total: all.length, page, pageSize };
}
