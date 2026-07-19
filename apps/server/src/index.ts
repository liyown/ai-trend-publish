import { initializeAppConfig, parseConfigArgs } from "@trendpublish/core/config";
import { Logger, LogLevel } from "@trendpublish/core/logging";
import startServer from "./server.ts";
async function bootstrap() {
  const parsedArgs = parseConfigArgs(process.argv.slice(2));
  const config = await initializeAppConfig({
    configPath: parsedArgs.configPath,
  });
  Logger.level = LogLevel.INFO;

  await startServer(config.server.port);
}

bootstrap().catch(console.error);
