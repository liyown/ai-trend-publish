export interface CloudflareD1PreparedStatement {
  bind(...values: unknown[]): CloudflareD1PreparedStatement;
  run<T = unknown>(): Promise<{ success: boolean; meta: unknown; results?: T[] }>;
  all<T = unknown>(): Promise<{ success: boolean; results: T[]; meta: unknown }>;
  first<T = unknown>(): Promise<T | null>;
}

export interface CloudflareD1Database {
  prepare(query: string): CloudflareD1PreparedStatement;
  exec(query: string): Promise<{ count: number; duration: number }>;
}
