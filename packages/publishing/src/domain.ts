import type { ContentPackage, PublicationMetadataValue } from "@trendpublish/contracts";

export type {
  PreparedPublication,
  PreparedPublicationBody,
  PreparedPublicationInput,
  PublicationBatchResult,
  PublicationMetadataValue,
  PublishReceipt,
  DestinationPublicationResult,
} from "@trendpublish/contracts/publishing";

export interface ChannelAccount {
  id: string;
  channel: string;
  name: string;
  connectionId: string;
  revision: number;
  config?: Record<string, PublicationMetadataValue>;
  publisher?: {
    toolConnectionIds: string[];
  };
}

export interface PublicationDestination {
  id: string;
  channel: string;
  accountId: string;
  publicationType: string;
  options?: Record<string, PublicationMetadataValue>;
}

export interface PublicationRequest {
  contentPackage: ContentPackage;
  destinations: PublicationDestination[];
  accounts: ChannelAccount[];
}
