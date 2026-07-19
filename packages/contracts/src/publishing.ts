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
}

export interface PreparedPublication extends PreparedPublicationInput {
  id: string;
  checksum: string;
  packageId: string;
  packageChecksum: string;
  targetId: string;
  targetRevision: number;
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

export interface TargetPublicationResult {
  targetId: string;
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
  targets: TargetPublicationResult[];
}
