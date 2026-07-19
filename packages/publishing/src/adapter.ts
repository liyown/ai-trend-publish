import type { ContentPackage } from "@trendpublish/article";
import type { TaskContext } from "@trendpublish/runtime";
import type {
  ChannelAccount,
  PreparedPublication,
  PreparedPublicationInput,
  PublishReceipt,
  PublishTarget,
} from "./domain.ts";

export interface PreparePublicationContext {
  task: TaskContext;
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
  prepare(
    contentPackage: ContentPackage,
    target: PublishTarget,
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
    if (this.adapters.has(adapter.channel)) {
      throw new Error(`渠道 ${adapter.channel} 已经注册发布适配器`);
    }
    this.adapters.set(adapter.channel, adapter);
  }

  get(channel: string): ChannelAdapter {
    const adapter = this.adapters.get(channel);
    if (!adapter) throw new Error(`渠道 ${channel} 没有发布适配器`);
    return adapter;
  }
}
