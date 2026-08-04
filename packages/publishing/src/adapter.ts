import type { ContentPackage } from "@trendpublish/article";
import type { ChatClient, ImageClient } from "@trendpublish/connectors";
import type { TaskContext } from "@trendpublish/runtime";
import type {
  ChannelAccount,
  PreparedPublication,
  PreparedPublicationInput,
  PublishReceipt,
  PublicationDestination,
} from "./domain.ts";

export interface PreparePublicationContext {
  task: TaskContext;
  model?: ChatClient;
  image?: ImageClient;
  now(): Date;
}

export interface PublishPublicationContext {
  task: TaskContext;
  idempotencyKey: string;
  now(): Date;
}

export interface ChannelAdapter {
  id: string;
  version: string;
  channel: string;
  publicationType: string;
  prepare(
    contentPackage: ContentPackage,
    destination: PublicationDestination,
    account: ChannelAccount,
    context: PreparePublicationContext,
  ): Promise<PreparedPublicationInput>;
  publish(
    prepared: PreparedPublication,
    account: ChannelAccount,
    context: PublishPublicationContext,
  ): Promise<PublishReceipt>;
}

export class ChannelAdapterRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor(adapters: ChannelAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ChannelAdapter): void {
    const key = `${adapter.channel}:${adapter.publicationType}`;
    if (this.adapters.has(key)) {
      throw new Error(`渠道发布类型 ${key} 已经注册发布适配器`);
    }
    this.adapters.set(key, adapter);
  }

  get(channel: string, publicationType: string): ChannelAdapter {
    const adapter = this.adapters.get(`${channel}:${publicationType}`);
    if (!adapter) throw new Error(`渠道 ${channel} 不支持发布类型 ${publicationType}`);
    return adapter;
  }
}
