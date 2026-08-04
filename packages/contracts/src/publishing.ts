import type { ContentAsset } from "./article.ts";
import type { JsonValue } from "./json.ts";

type ValueOf<T> = T[keyof T];

export const ChannelId = {
  WeixinOfficialAccount: "weixin-official-account",
} as const;
export type ChannelId = ValueOf<typeof ChannelId>;

export const PublicationTargetStatus = {
  Succeeded: "succeeded",
  Failed: "failed",
  Unknown: "unknown",
} as const;
export type PublicationTargetStatus = ValueOf<typeof PublicationTargetStatus>;

export const PublicationBatchStatus = {
  Succeeded: "succeeded",
  Partial: "partial",
  Failed: "failed",
  NeedsAttention: "needs_attention",
} as const;
export type PublicationBatchStatus = ValueOf<typeof PublicationBatchStatus>;

export const ChannelVariantSchemaVersion = "channel-variant.v1" as const;

export type ContentModality = "article" | "image" | "video" | "audio";

/** A safe capability slot that a channel publication session may use. */
export interface PublisherToolRequirement {
  id: string;
  name: string;
  description: string;
  capability: string;
  required?: boolean;
}

export interface PublicationTypeProfileDefinition {
  channel: string;
  type: string;
  version: string;
  name: string;
  description: string;
  supportedModalities: ContentModality[];
  requiredArtifacts: string[];
  optionalArtifacts: string[];
  /** Connector capabilities that can be referenced by an account's publisher configuration. */
  publisherTools?: PublisherToolRequirement[];
}

/** Validated output of one target-specific channel adaptation ReAct session. */
export interface ChannelVariant {
  schemaVersion: typeof ChannelVariantSchemaVersion;
  id: string;
  checksum: string;
  packageId: string;
  packageChecksum: string;
  destinationId: string;
  channel: string;
  publicationType: string;
  profileVersion: string;
  payload: JsonValue;
  assetIds: string[];
  createdAt: string;
}

export type PublicationMetadataValue = JsonValue;

export interface PreparedPublicationBody {
  format: string;
  content: string;
}

export interface PreparedPublicationInput {
  title: string;
  digest: string;
  body: PreparedPublicationBody;
  assets: ContentAsset[];
  metadata?: Record<string, PublicationMetadataValue>;
  variant?: ChannelVariant;
}

export interface PreparedPublication extends PreparedPublicationInput {
  id: string;
  checksum: string;
  packageId: string;
  packageChecksum: string;
  destinationId: string;
  accountId: string;
  accountRevision: number;
  adapterId: string;
  adapterVersion: string;
  createdAt: string;
}

export interface PublishReceipt {
  status: PublicationTargetStatus;
  externalId?: string;
  url?: string;
  message?: string;
  publishedAt: string;
  metadata?: Record<string, PublicationMetadataValue>;
}

export interface DestinationPublicationResult {
  destinationId: string;
  accountId: string;
  status: PublishReceipt["status"];
  prepared?: PreparedPublication;
  receipt?: PublishReceipt;
  error?: string;
}

export interface PublicationBatchResult {
  requestId: string;
  packageId: string;
  status: PublicationBatchStatus;
  destinations: DestinationPublicationResult[];
}

/** Safe, on-demand view of a prepared channel payload for the Dashboard. */
export interface ChannelPublicationPreview {
  destinationId: string;
  channel: string;
  publicationType: string;
  title: string;
  digest: string;
  body: PreparedPublicationBody;
  cover?: {
    assetId: string;
    source: string;
    mimeType?: string;
    alt?: string;
    width?: number;
    height?: number;
  };
}
