import { PublicationBatchStatus, PublicationTargetStatus } from "@trendpublish/contracts";
import { verifyContentPackageChecksum } from "@trendpublish/article";
import type { ChatClient, ImageClient } from "@trendpublish/connectors";
import {
  describeUnknown,
  fingerprint,
  TaskNeedsAttentionError,
  type TaskContext,
} from "@trendpublish/runtime";
import type { ChannelAdapter } from "./adapter.ts";
import type { ChannelRegistry, PublicationTypeProfile } from "./profile.ts";
import type {
  ChannelAccount,
  PreparedPublication,
  PreparedPublicationInput,
  PublicationBatchResult,
  PublicationDestination,
  PublicationRequest,
  PublishReceipt,
  DestinationPublicationResult,
} from "./domain.ts";

export interface PublicationRunnerOptions {
  now?: () => Date;
  resolveModel?: (contentPackage: PublicationRequest["contentPackage"]) => Promise<ChatClient>;
  resolveImage?: (
    contentPackage: PublicationRequest["contentPackage"],
    destination: PublicationDestination,
    account: ChannelAccount,
  ) => Promise<ImageClient | undefined>;
}

export class PublicationRunner {
  private readonly now: () => Date;

  constructor(
    private readonly channels: ChannelRegistry,
    private readonly options: PublicationRunnerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async publish(request: PublicationRequest, task: TaskContext): Promise<PublicationBatchResult> {
    if (!(await verifyContentPackageChecksum(request.contentPackage))) {
      throw new Error(`内容包 ${request.contentPackage.id} 完整性校验失败`);
    }
    const requestInput = normalizedRequest(request);
    const model = this.options.resolveModel
      ? await this.options.resolveModel(request.contentPackage)
      : undefined;
    const requestId = await fingerprint(requestInput);
    await task.run(
      { id: "publication-request", version: "1", input: requestInput },
      async () => requestId,
    );

    const accounts = new Map(request.accounts.map((account) => [account.id, account]));
    const results: DestinationPublicationResult[] = [];
    for (const destination of request.destinations) {
      const account = accounts.get(destination.accountId);
      if (!account) {
        results.push(
          failedDestination(destination, destination.accountId, "发布目的地引用的账号不存在"),
        );
        continue;
      }
      if (destination.channel !== account.channel) {
        results.push(failedDestination(destination, account.id, "发布目的地与账号渠道不一致"));
        continue;
      }
      let adapter: ChannelAdapter;
      let profile: PublicationTypeProfile;
      try {
        profile = this.channels.getProfile(destination.channel, destination.publicationType);
        adapter = this.channels.getAdapter(destination.channel, destination.publicationType);
      } catch (error) {
        results.push(failedDestination(destination, account.id, errorMessage(error)));
        continue;
      }
      let image: ImageClient | undefined;
      try {
        const imageTools =
          profile.definition.publisherTools?.filter((tool) => tool.capability === "image") ?? [];
        if (imageTools.length > 0) {
          image = this.options.resolveImage
            ? await this.options.resolveImage(request.contentPackage, destination, account)
            : undefined;
          if (!image && imageTools.some((tool) => tool.required)) {
            throw new Error("发布账号未配置可用的图片生成连接");
          }
        }
      } catch (error) {
        results.push(failedDestination(destination, account.id, errorMessage(error)));
        continue;
      }
      results.push(
        await this.publishDestination(
          request,
          destination,
          account,
          adapter,
          model,
          image,
          task.scope(`destination:${destination.id}`),
        ),
      );
    }

    return {
      requestId,
      packageId: request.contentPackage.id,
      status: aggregateStatus(results),
      destinations: results,
    };
  }

  private async publishDestination(
    request: PublicationRequest,
    destination: PublicationDestination,
    account: ChannelAccount,
    adapter: ChannelAdapter,
    model: ChatClient | undefined,
    image: ImageClient | undefined,
    task: TaskContext,
  ): Promise<DestinationPublicationResult> {
    let prepared: PreparedPublication;
    try {
      const input = await task.run(
        {
          id: "prepare",
          version: adapter.version,
          input: {
            packageChecksum: request.contentPackage.checksum,
            destination,
            account: publicAccountSnapshot(account),
            adapter: { id: adapter.id, version: adapter.version },
          },
        },
        async () =>
          adapter.prepare(request.contentPackage, destination, account, {
            task: task.scope("prepare-internal"),
            model,
            image,
            now: this.now,
          }),
      );
      prepared = await freezePreparedPublication({
        input,
        contentPackage: request.contentPackage,
        destination,
        account,
        adapter,
        createdAt: this.now().toISOString(),
      });
    } catch (error) {
      return failedDestination(destination, account.id, errorMessage(error));
    }

    const idempotencyKey = await fingerprint({
      preparedChecksum: prepared.checksum,
      packageChecksum: request.contentPackage.checksum,
      destinationId: destination.id,
      accountId: account.id,
      accountRevision: account.revision,
      adapterId: adapter.id,
      adapterVersion: adapter.version,
    });

    try {
      const receipt = await adapter.publish(prepared, account, {
        task: task.scope("publish"),
        idempotencyKey,
        now: this.now,
      });
      const savedReceipt = await task.run(
        {
          id: "receipt",
          version: "1",
          input: { preparedChecksum: prepared.checksum, receipt },
        },
        async () => receipt,
      );
      return destinationResult(destination, account, prepared, savedReceipt);
    } catch (error) {
      const unknown = error instanceof TaskNeedsAttentionError;
      return {
        destinationId: destination.id,
        accountId: account.id,
        status: unknown ? PublicationTargetStatus.Unknown : PublicationTargetStatus.Failed,
        prepared,
        error: errorMessage(error),
      };
    }
  }
}

async function freezePreparedPublication({
  input,
  contentPackage,
  destination,
  account,
  adapter,
  createdAt,
}: {
  input: PreparedPublicationInput;
  contentPackage: PublicationRequest["contentPackage"];
  destination: PublicationDestination;
  account: ChannelAccount;
  adapter: ChannelAdapter;
  createdAt: string;
}): Promise<PreparedPublication> {
  const payload = {
    ...structuredClone(input),
    packageId: contentPackage.id,
    packageChecksum: contentPackage.checksum,
    destinationId: destination.id,
    accountId: account.id,
    accountRevision: account.revision,
    adapterId: adapter.id,
    adapterVersion: adapter.version,
  };
  const checksum = await fingerprint(payload);
  return {
    id: `prepared_${checksum.slice(0, 24)}`,
    checksum,
    ...payload,
    createdAt,
  };
}

function normalizedRequest(request: PublicationRequest): unknown {
  return {
    packageId: request.contentPackage.id,
    packageChecksum: request.contentPackage.checksum,
    destinations: [...request.destinations]
      .map((destination) => structuredClone(destination))
      .sort((left, right) => left.id.localeCompare(right.id)),
    accounts: [...request.accounts]
      .map(publicAccountSnapshot)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function publicAccountSnapshot(account: ChannelAccount) {
  return {
    id: account.id,
    channel: account.channel,
    name: account.name,
    connectionId: account.connectionId,
    revision: account.revision,
    config: structuredClone(account.config),
    publisher: structuredClone(account.publisher),
  };
}

function destinationResult(
  destination: PublicationDestination,
  account: ChannelAccount,
  prepared: PreparedPublication,
  receipt: PublishReceipt,
): DestinationPublicationResult {
  return {
    destinationId: destination.id,
    accountId: account.id,
    status: receipt.status,
    prepared,
    receipt,
    error: receipt.status === PublicationTargetStatus.Succeeded ? undefined : receipt.message,
  };
}

function failedDestination(
  destination: PublicationDestination,
  accountId: string,
  error: string,
): DestinationPublicationResult {
  return {
    destinationId: destination.id,
    accountId,
    status: PublicationTargetStatus.Failed,
    error,
  };
}

function aggregateStatus(results: DestinationPublicationResult[]): PublicationBatchStatus {
  if (results.some((result) => result.status === PublicationTargetStatus.Unknown)) {
    return PublicationBatchStatus.NeedsAttention;
  }
  const successes = results.filter(
    (result) => result.status === PublicationTargetStatus.Succeeded,
  ).length;
  if (successes === results.length && results.length > 0) {
    return PublicationBatchStatus.Succeeded;
  }
  if (successes > 0) return PublicationBatchStatus.Partial;
  return PublicationBatchStatus.Failed;
}

function errorMessage(error: unknown): string {
  return describeUnknown(error);
}
