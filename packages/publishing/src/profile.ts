import type {
  ChannelDefinition,
  JsonObject,
  PublicationTypeProfileDefinition,
} from "@trendpublish/contracts";
import type { ChannelAdapter } from "./adapter.ts";

export interface PublicationTypeProfile<TPayload extends JsonObject = JsonObject> {
  definition: PublicationTypeProfileDefinition;
  instructions: string;
  outputSchema: JsonObject;
  parse(value: JsonObject): TPayload;
  migrateLegacyOptions?(value: JsonObject): JsonObject;
}

export class PublicationTypeProfileRegistry {
  private readonly profiles = new Map<string, PublicationTypeProfile>();

  constructor(profiles: PublicationTypeProfile[] = []) {
    for (const profile of profiles) this.register(profile);
  }

  register(profile: PublicationTypeProfile): void {
    const key = profileKey(profile.definition.channel, profile.definition.type);
    if (this.profiles.has(key)) throw new Error(`发布类型 ${key} 已经注册`);
    this.profiles.set(key, profile);
  }

  get(channel: string, type: string): PublicationTypeProfile {
    const profile = this.profiles.get(profileKey(channel, type));
    if (!profile) throw new Error(`渠道 ${channel} 不支持发布类型 ${type}`);
    return profile;
  }

  definitions(): PublicationTypeProfileDefinition[] {
    return [...this.profiles.values()].map((profile) => structuredClone(profile.definition));
  }
}

export interface ChannelRegistration {
  definition: ChannelDefinition;
  profiles: PublicationTypeProfile[];
  adapters: ChannelAdapter[];
}

/** Internal source of truth for safe channel catalog, ReAct profiles and deterministic adapters. */
export class ChannelRegistry {
  private readonly channels = new Map<string, ChannelRegistration>();
  private readonly profiles = new PublicationTypeProfileRegistry();
  private readonly adapters = new Map<string, ChannelAdapter>();

  constructor(registrations: ChannelRegistration[] = []) {
    for (const registration of registrations) this.register(registration);
  }

  register(registration: ChannelRegistration): void {
    const { definition } = registration;
    if (this.channels.has(definition.id)) throw new Error(`渠道 ${definition.id} 已经注册`);
    if (
      !registration.profiles.some(
        (profile) => profile.definition.type === definition.defaultPublicationType,
      )
    ) {
      throw new Error(
        `渠道 ${definition.id} 缺少默认发布类型 ${definition.defaultPublicationType}`,
      );
    }
    for (const profile of registration.profiles) {
      if (profile.definition.channel !== definition.id) throw new Error("渠道 Profile 归属不一致");
      this.profiles.register(profile);
    }
    for (const adapter of registration.adapters) {
      if (adapter.channel !== definition.id) throw new Error("渠道 Adapter 归属不一致");
      const key = profileKey(adapter.channel, adapter.publicationType);
      if (this.adapters.has(key)) throw new Error(`渠道 Adapter ${key} 已经注册`);
      this.profiles.get(adapter.channel, adapter.publicationType);
      this.adapters.set(key, adapter);
    }
    for (const profile of registration.profiles) {
      if (!this.adapters.has(profileKey(definition.id, profile.definition.type))) {
        throw new Error(`渠道 ${definition.id} 的 ${profile.definition.type} 缺少发布 Adapter`);
      }
    }
    this.channels.set(definition.id, registration);
  }

  definitions(): ChannelDefinition[] {
    return [...this.channels.values()].map((item) => structuredClone(item.definition));
  }

  profileDefinitions(): PublicationTypeProfileDefinition[] {
    return this.profiles.definitions();
  }

  getDefinition(channel: string): ChannelDefinition {
    const registration = this.channels.get(channel);
    if (!registration) throw new Error(`未知发布渠道 ${channel}`);
    return registration.definition;
  }

  getProfile(channel: string, publicationType: string): PublicationTypeProfile {
    return this.profiles.get(channel, publicationType);
  }

  getAdapter(channel: string, publicationType: string): ChannelAdapter {
    const adapter = this.adapters.get(profileKey(channel, publicationType));
    if (!adapter) throw new Error(`渠道 ${channel} 不支持发布类型 ${publicationType}`);
    return adapter;
  }
}

function profileKey(channel: string, type: string): string {
  return `${channel}:${type}`;
}
