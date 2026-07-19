import { initializeAppConfig } from "@trendpublish/core/config";
import { Logger, LogLevel } from "@trendpublish/core/logging";
import startServer from "./server.ts";
async function bootstrap() {
  const config = initializeAppConfig();
  Logger.level = LogLevel.INFO;

  await startServer(config.server.port);
}

bootstrap().catch(console.error);
