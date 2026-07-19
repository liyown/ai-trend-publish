import type { ContentPackage, PublicationMetadataValue } from "@trendpublish/contracts";

export type {
  PreparedPublication,
  PreparedPublicationBody,
  PreparedPublicationInput,
  PublicationBatchResult,
  PublicationMetadataValue,
  PublishReceipt,
  TargetPublicationResult,
} from "@trendpublish/contracts/publishing";

export interface ChannelAccount {
  id: string;
  channel: string;
  name: string;
  connectionId: string;
  revision: number;
  config?: Record<string, PublicationMetadataValue>;
}

export interface PublishTarget {
  id: string;
  name: string;
  channel: string;
  channelAccountId: string;
  revision: number;
  config?: Record<string, PublicationMetadataValue>;
}

export interface PublicationRequest {
  contentPackage: ContentPackage;
  targets: PublishTarget[];
  accounts: ChannelAccount[];
}
