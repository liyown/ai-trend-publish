import { defineConfig } from "@trendpublish/core/config";

export default defineConfig({
  server: { apiKey: "change-me", port: 8000 },
  database: { sqlitePath: "data/trendpublish.sqlite3" },
  observability: {
    enabled: true,
    serviceName: "trendpublish",
    environment: "local",
    stdout: { enabled: false, format: "json" },
  },
});
