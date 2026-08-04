import {
  WorkspaceKind,
  type JsonObject,
  type PublicationDestinationSelection,
} from "@trendpublish/contracts";
import type { ConnectorManager } from "@trendpublish/connectors";
import {
  createWorkspaceEntity,
  LegacyWorkspaceKind,
  reviseWorkspaceEntity,
  type LegacyPublishTarget,
  type WorkspaceRepository,
} from "@trendpublish/core/workspace";
import type { ChannelRegistry } from "@trendpublish/publishing";
import { fingerprint } from "@trendpublish/runtime";

const MIGRATION_ID = "publishing-destinations-v2";
const MIGRATION_VERSION = "2";

interface MigrationRuntime {
  workspace: WorkspaceRepository;
  connectionManager: ConnectorManager;
  channels: ChannelRegistry;
}

interface LegacyPublishing {
  mode?: "content_only" | "publish";
  targetIds?: string[];
  destinations?: PublicationDestinationSelection[];
}

/** Idempotent upgrade from public targets/shared channel connections to account destinations. */
export async function migratePublishingModel(runtime: MigrationRuntime): Promise<void> {
  await runtime.workspace.ensureSchema();
  if (await runtime.workspace.get(LegacyWorkspaceKind.Migration, MIGRATION_ID)) return;

  const [targets, accounts, plans, publications, connections] = await Promise.all([
    runtime.workspace.list(LegacyWorkspaceKind.PublishTarget),
    runtime.workspace.list(WorkspaceKind.ChannelAccount),
    runtime.workspace.list(WorkspaceKind.ContentPlan),
    runtime.workspace.list(WorkspaceKind.Publication),
    runtime.connectionManager.list(),
  ]);
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  const destinationByTarget = new Map<string, PublicationDestinationSelection>();

  // Validate every legacy target and channel profile before making any destructive change.
  for (const target of targets) {
    const account = accountsById.get(target.channelAccountId);
    if (!account) throw new Error(`旧发布目标 ${target.id} 引用的账号不存在`);
    const channel = runtime.channels.getDefinition(account.channel);
    const publicationType = target.publicationType ?? channel.defaultPublicationType;
    const profile = runtime.channels.getProfile(account.channel, publicationType);
    runtime.channels.getAdapter(account.channel, publicationType);
    let options: JsonObject | undefined;
    if (Object.keys(target.settings).length) {
      if (!profile.migrateLegacyOptions) {
        throw new Error(`旧发布目标 ${target.id} 的设置没有可用迁移函数`);
      }
      options = profile.migrateLegacyOptions(target.settings);
    }
    destinationByTarget.set(target.id, {
      accountId: account.id,
      publicationType,
      ...(options && Object.keys(options).length ? { options } : {}),
    });
  }
  for (const plan of plans) {
    const publishing = plan.publishing as unknown as LegacyPublishing;
    for (const targetId of publishing.targetIds ?? []) {
      if (!targetsById.has(targetId)) {
        throw new Error(`内容方案 ${plan.id} 引用了无法迁移的旧发布目标 ${targetId}`);
      }
    }
  }
  for (const account of accounts) {
    const connection = connectionsById.get(account.connectionId);
    if (!connection) throw new Error(`发布账号 ${account.id} 的连接不存在`);
    const channel = runtime.channels.getDefinition(account.channel);
    if (!channel.connectorIds.includes(connection.connectorId)) {
      throw new Error(`发布账号 ${account.id} 的接入方式不受渠道 ${account.channel} 支持`);
    }
  }

  const oldConnectionIds = new Set<string>();
  for (const account of accounts) {
    const connection = connectionsById.get(account.connectionId)!;
    const managedId = `channel-${account.id}`;
    const metadata: JsonObject = { managedBy: "channel-account", accountId: account.id };
    const managed =
      connection.id === managedId
        ? await runtime.connectionManager.manage(managedId, { name: account.name, metadata })
        : await runtime.connectionManager.clone(connection.id, {
            id: managedId,
            name: account.name,
            metadata,
          });
    if (connection.id !== managedId) oldConnectionIds.add(connection.id);
    if (
      account.connectionId !== managed.id ||
      account.connectorId !== managed.connectorId ||
      account.enabled === undefined
    ) {
      const next = reviseWorkspaceEntity(account, {
        name: account.name,
        enabled: account.enabled !== false && managed.enabled,
        channel: account.channel,
        connectionId: managed.id,
        settings: managed.settings,
        connectorId: managed.connectorId,
        credentialState: managed.credentialState,
      });
      await runtime.workspace.save(WorkspaceKind.ChannelAccount, next);
      accountsById.set(account.id, next);
    }
  }

  for (const plan of plans) {
    const legacy = plan.publishing as unknown as LegacyPublishing;
    if (Array.isArray(legacy.destinations)) continue;
    const selections =
      legacy.mode === "publish"
        ? (legacy.targetIds ?? []).map((id) => destinationByTarget.get(id)!)
        : [];
    const destinations = uniqueDestinations(selections);
    await runtime.workspace.save(
      WorkspaceKind.ContentPlan,
      reviseWorkspaceEntity(plan, { ...withoutPublishing(plan), publishing: { destinations } }),
    );
  }

  for (const publication of publications) {
    const legacyBatch = publication.batch as unknown as {
      targets?: Array<Record<string, unknown>>;
      destinations?: unknown[];
    };
    if (!legacyBatch.targets || Array.isArray(legacyBatch.destinations)) continue;
    const destinations = await Promise.all(
      legacyBatch.targets.map(async (result) => {
        const targetId = result["targetId"];
        if (typeof targetId !== "string" || !targetId) {
          throw new Error(`历史发布记录 ${publication.id} 缺少旧目标标识`);
        }
        const selection = destinationByTarget.get(targetId);
        if (!selection)
          throw new Error(`历史发布记录 ${publication.id} 引用了未知目标 ${targetId}`);
        const account = accountsById.get(selection.accountId)!;
        return renameResult(result, await destinationId(account.channel, selection));
      }),
    );
    const { targets: _targets, ...batch } = publication.batch as unknown as Record<string, unknown>;
    await runtime.workspace.save(
      WorkspaceKind.Publication,
      reviseWorkspaceEntity(publication, {
        jobId: publication.jobId,
        packageId: publication.packageId,
        batch: { ...batch, destinations } as unknown as typeof publication.batch,
      }),
    );
  }

  // Legacy targets are removed only after all references and history have been converted.
  for (const target of targets)
    await runtime.workspace.remove(LegacyWorkspaceKind.PublishTarget, target.id);

  const referencedConnections = new Set<string>();
  for (const account of await runtime.workspace.list(WorkspaceKind.ChannelAccount)) {
    referencedConnections.add(account.connectionId);
  }
  for (const plan of await runtime.workspace.list(WorkspaceKind.ContentPlan)) {
    for (const id of Object.values(plan.connections)) referencedConnections.add(id);
    for (const id of plan.agent?.toolConnectionIds ?? []) referencedConnections.add(id);
    for (const id of plan.researchConnections?.search ?? []) referencedConnections.add(id);
    for (const id of plan.researchConnections?.fetch ?? []) referencedConnections.add(id);
  }
  for (const id of oldConnectionIds) {
    if (!referencedConnections.has(id)) await runtime.connectionManager.remove(id);
  }

  await runtime.workspace.save(
    LegacyWorkspaceKind.Migration,
    createWorkspaceEntity({
      id: MIGRATION_ID,
      version: MIGRATION_VERSION,
      completedAt: new Date().toISOString(),
    }),
  );
}

function withoutPublishing<T extends { publishing: unknown }>(value: T): Omit<T, "publishing"> {
  const { publishing: _publishing, ...rest } = value;
  return rest;
}

function uniqueDestinations(
  values: PublicationDestinationSelection[],
): PublicationDestinationSelection[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.accountId}:${value.publicationType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function destinationId(
  channel: string,
  selection: PublicationDestinationSelection,
): Promise<string> {
  const checksum = await fingerprint({
    accountId: selection.accountId,
    channel,
    publicationType: selection.publicationType,
    options: selection.options ?? {},
  });
  return `destination_${checksum.slice(0, 24)}`;
}

function renameResult(
  result: Record<string, unknown>,
  resolvedDestinationId: string,
): Record<string, unknown> {
  const renamed = renameKeys(result) as Record<string, unknown>;
  renamed["destinationId"] = resolvedDestinationId;
  return renamed;
}

function renameKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "targetRevision")
      .map(([key, nested]) => [
        key === "targetId" ? "destinationId" : key === "targets" ? "destinations" : key,
        renameKeys(nested),
      ]),
  );
}

export type { LegacyPublishTarget };
