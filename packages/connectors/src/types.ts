import type { JsonObject, JsonValue } from "@trendpublish/contracts";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RequestOverrides,
} from "@trendpublish/contracts";

export type ConnectorCapability = string;

export interface CapabilityToken<TClient> {
  readonly key: ConnectorCapability;
  readonly __client?: TClient;
}

export function defineCapability<TClient>(key: string): CapabilityToken<TClient> {
  return Object.freeze({ key });
}

export interface CallContext {
  signal?: AbortSignal;
  traceId?: string;
  taskId?: string;
  idempotencyKey?: string;
  onEvent?: (event: ConnectorCallEvent) => void;
}

export type ConnectorCallEvent =
  | { type: "response.started"; model?: string }
  | { type: "response.delta"; delta: string; accumulatedCharacters: number }
  | {
      type: "response.completed";
      model?: string;
      usage?: ChatOutput["usage"];
      accumulatedCharacters: number;
    };

export interface ConnectorOperation {
  name: string;
  capability: ConnectorCapability;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface ChatOutput {
  content: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  raw?: JsonValue;
}

export interface ChatClient {
  complete(input: ChatInput, context?: CallContext): Promise<ChatOutput>;
}

export const ChatCapability = defineCapability<ChatClient>("chat");

export interface EmbeddingInput {
  input: string | string[];
  model?: string;
  dimensions?: number;
  encodingFormat?: "float" | "base64";
}

export interface EmbeddingOutput {
  embeddings: number[][];
  model?: string;
  usage?: { tokens?: number };
  raw?: JsonValue;
}

export interface EmbeddingClient {
  embed(input: EmbeddingInput, context?: CallContext): Promise<EmbeddingOutput>;
}

export const EmbeddingCapability = defineCapability<EmbeddingClient>("embedding");

export interface ImageInput extends JsonObject {
  prompt: string;
  model?: string;
}

export interface ImageOutput {
  images: Array<{ url?: string; base64?: string; mimeType?: string }>;
  taskId?: string;
  raw?: JsonValue;
}

export interface ImageClient {
  generate(input: ImageInput, context?: CallContext): Promise<ImageOutput>;
}

export const ImageCapability = defineCapability<ImageClient>("image");

export interface SourceSearchInput {
  query: string;
  limit?: number;
}

/** A discovery result. Its snippet is never treated as evidence material. */
export interface SourceCandidate {
  id: string;
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  author?: string;
  sourceName?: string;
}

export interface SourceDocument {
  id: string;
  mediaType?: "webpage" | "image" | "video" | "audio" | "document";
  title: string;
  content?: string;
  transcript?: string;
  durationMs?: number;
  url?: string;
  publishedAt?: string;
  author?: string;
  sourceName?: string;
}

export interface SourceSearchClient {
  search(input: SourceSearchInput, context?: CallContext): Promise<SourceCandidate[]>;
}

export const SourceSearchCapability = defineCapability<SourceSearchClient>("source-search");

export interface SourceFetchClient {
  fetch(url: string, context?: CallContext): Promise<SourceDocument[]>;
}

export const SourceFetchCapability = defineCapability<SourceFetchClient>("source-fetch");

export interface NotificationInput {
  title: string;
  content: string;
  level?: "active" | "timeSensitive" | "passive";
  url?: string;
  extras?: JsonObject;
}

export interface NotificationOutput {
  accepted: boolean;
  requestId?: string;
  raw?: JsonValue;
}

export interface NotificationClient {
  send(input: NotificationInput, context?: CallContext): Promise<NotificationOutput>;
}

export const NotificationCapability = defineCapability<NotificationClient>("notification");
