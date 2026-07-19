import { PublicationBatchStatus, PublicationTargetStatus } from "@trendpublish/contracts";
import { verifyContentPackageChecksum } from "@trendpublish/article";
import {
  describeUnknown,
  fingerprint,
  TaskNeedsAttentionError,
  type TaskContext,
} from "@trendpublish/runtime";
import type { ChannelAdapter, ChannelAdapterRegistry } from "./adapter.ts";
import type {
  ChannelAccount,
  PreparedPublication,
  PreparedPublicationInput,
  PublicationBatchResult,
  PublicationRequest,
  PublishReceipt,
  PublishTarget,
  TargetPublicationResult,
} from "./domain.ts";

export interface PublicationRunnerOptions {
  now?: () => Date;
}

export class PublicationRunner {
  private readonly now: () => Date;

  constructor(
    private readonly adapters: ChannelAdapterRegistry,
    options: PublicationRunnerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async publish(request: PublicationRequest, task: TaskContext): Promise<PublicationBatchResult> {
    if (!(await verifyContentPackageChecksum(request.contentPackage))) {
      throw new Error(`内容包 ${request.contentPackage.id} 完整性校验失败`);
    }
    const requestInput = normalizedRequest(request);
    const requestId = await fingerprint(requestInput);
    await task.run(
      { id: "publication-request", version: "1", input: requestInput },
      async () => requestId,
    );

    const accounts = new Map(request.accounts.map((account) => [account.id, account]));
    const results: TargetPublicationResult[] = [];
    for (const target of request.targets) {
      const account = accounts.get(target.channelAccountId);
      if (!account) {
        results.push(failedTarget(target, target.channelAccountId, "发布目标引用的渠道账号不存在"));
        continue;
      }
      if (target.channel !== account.channel) {
        results.push(failedTarget(target, account.id, "发布目标与渠道账号类型不一致"));
        continue;
      }
      const adapter = this.adapters.get(target.channel);
      results.push(
        await this.publishTarget(
          request,
          target,
          account,
          adapter,
          task.scope(`target:${target.id}`),
        ),
      );
    }

    return {
      requestId,
      packageId: request.contentPackage.id,
      status: aggregateStatus(results),
      targets: results,
    };
  }

  private async publishTarget(
    request: PublicationRequest,
    target: PublishTarget,
    account: ChannelAccount,
    adapter: ChannelAdapter,
    task: TaskContext,
  ): Promise<TargetPublicationResult> {
    let prepared: PreparedPublication;
    try {
      const input = await task.run(
        {
          id: "prepare",
          version: adapter.version,
          input: {
            packageChecksum: request.contentPackage.checksum,
            target,
            account: publicAccountSnapshot(account),
            adapter: { id: adapter.id, version: adapter.version },
          },
        },
        async () =>
          adapter.prepare(request.contentPackage, target, account, {
            task: task.scope("prepare-internal"),
            now: this.now,
          }),
      );
      prepared = await freezePreparedPublication({
        input,
        contentPackage: request.contentPackage,
        target,
        account,
        adapter,
        createdAt: this.now().toISOString(),
      });
    } catch (error) {
      return failedTarget(target, account.id, errorMessage(error));
    }

    const idempotencyKey = await fingerprint({
      preparedChecksum: prepared.checksum,
      packageChecksum: request.contentPackage.checksum,
      targetId: target.id,
      targetRevision: target.revision,
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
      return targetResult(target, account, prepared, savedReceipt);
    } catch (error) {
      const unknown = error instanceof TaskNeedsAttentionError;
      return {
        targetId: target.id,
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
  target,
  account,
  adapter,
  createdAt,
}: {
  input: PreparedPublicationInput;
  contentPackage: PublicationRequest["contentPackage"];
  target: PublishTarget;
  account: ChannelAccount;
  adapter: ChannelAdapter;
  createdAt: string;
}): Promise<PreparedPublication> {
  const payload = {
    ...structuredClone(input),
    packageId: contentPackage.id,
    packageChecksum: contentPackage.checksum,
    targetId: target.id,
    targetRevision: target.revision,
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
    targets: [...request.targets]
      .map((target) => structuredClone(target))
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
  };
}

function targetResult(
  target: PublishTarget,
  account: ChannelAccount,
  prepared: PreparedPublication,
  receipt: PublishReceipt,
): TargetPublicationResult {
  return {
    targetId: target.id,
    accountId: account.id,
    status: receipt.status,
    prepared,
    receipt,
    error: receipt.status === PublicationTargetStatus.Succeeded ? undefined : receipt.message,
  };
}

function failedTarget(
  target: PublishTarget,
  accountId: string,
  error: string,
): TargetPublicationResult {
  return { targetId: target.id, accountId, status: PublicationTargetStatus.Failed, error };
}

function aggregateStatus(results: TargetPublicationResult[]): PublicationBatchStatus {
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
