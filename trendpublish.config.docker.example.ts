import { defineConfig } from "@trendpublish/core/config";

export default defineConfig((runtime) => ({
  server: { apiKey: runtime.required("SERVER_API_KEY"), port: 8000 },
  database: { sqlitePath: "/app/data/trendpublish.sqlite3" },
}));
