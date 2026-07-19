import { ConnectorRegistry } from "../registry.ts";
import { dashScopeConnector } from "./dashscope.ts";
import { openAICompatibleConnector } from "./openai-compatible.ts";
import { miniMaxConnector } from "./minimax.ts";
import { barkConnector, dingTalkConnector, feishuConnector } from "./notifications.ts";
import { weixinOfficialAccountConnector, weixinRelayConnector } from "./weixin.ts";
import { sourceConnectors } from "./sources.ts";

export * from "./openai-compatible.ts";
export * from "./dashscope.ts";
export * from "./minimax.ts";
export * from "./notifications.ts";
export * from "./weixin.ts";
export * from "./sources.ts";

export const builtInConnectors = [
  openAICompatibleConnector,
  dashScopeConnector,
  miniMaxConnector,
  barkConnector,
  dingTalkConnector,
  feishuConnector,
  weixinOfficialAccountConnector,
  weixinRelayConnector,
  ...sourceConnectors,
];

export function createBuiltInConnectorRegistry(): ConnectorRegistry {
  return new ConnectorRegistry(builtInConnectors);
}
