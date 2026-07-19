import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/server/src/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-useless-default-assignment": "off",
      "typescript/unbound-method": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    tasks: {
      // ── 开发 ────────────────────────────────────────────────────────────────
      dev: { command: "vp exec tsx packages/ops/src/dev.ts", cache: false },
      "dev:api": { command: "vp run @trendpublish/server#dev", cache: false },
      "dev:dashboard": { command: "vp run @trendpublish/dashboard#dev", cache: false },

      // ── 诊断 ────────────────────────────────────────────────────────────────
      doctor: { command: "vp exec tsx packages/ops/src/doctor.ts", cache: false },

      // ── Weixin relay ────────────────────────────────────────────────────────
      relay: { command: "vp run @trendpublish/server#relay", cache: false },
      "relay:systemd": {
        command: "vp exec tsx packages/ops/src/print-relay-systemd.ts",
        cache: false,
      },
      "relay:install": {
        command: "vp exec tsx packages/ops/src/install-relay-systemd.ts",
        cache: false,
      },

      // ── Docker ──────────────────────────────────────────────────────────────
      "docker:up": { command: "docker compose up -d", cache: false },
      "docker:down": { command: "docker compose down", cache: false },
      "docker:logs": { command: "docker compose logs -f trendpublish", cache: false },
      "docker:build": { command: "docker build -t trendpublish .", cache: false },
      "docker:relay:up": {
        command: "docker compose -f docker-compose.relay.yml up -d",
        cache: false,
      },
      "docker:relay:down": {
        command: "docker compose -f docker-compose.relay.yml down",
        cache: false,
      },
      "docker:relay:logs": {
        command: "docker compose -f docker-compose.relay.yml logs -f weixin-relay",
        cache: false,
      },

      // ── Cloudflare ──────────────────────────────────────────────────────────
      "cf:dev": { command: "vp exec wrangler dev", cache: false },
      "cf:migrate:local": {
        command: "vp exec wrangler d1 migrations apply ARTICLE_DB --local",
        cache: false,
      },
      "cf:migrate": {
        command: "vp exec wrangler d1 migrations apply ARTICLE_DB --remote",
        cache: false,
      },
      "cf:dry-run": {
        command:
          "vp run @trendpublish/dashboard#build && vp exec wrangler deploy --dry-run --outdir .wrangler/dry-run",
        cache: false,
      },
      "cf:deploy": {
        command: "vp run @trendpublish/dashboard#build && vp exec wrangler deploy",
        cache: false,
      },
      "cf:sync-secrets": {
        command: "vp exec tsx packages/ops/src/cloudflare-sync-secrets.ts",
        cache: false,
      },
      "cf:smoke": { command: "vp exec tsx packages/ops/src/cloudflare-smoke.ts", cache: false },

      // ── 文档 ────────────────────────────────────────────────────────────────
      "docs:dev": { command: "vp exec vitepress dev docs", cache: false },
      "docs:build": {
        command: "vp exec vitepress build docs",
        input: ["docs/**", "package.json", "pnpm-lock.yaml"],
      },

      // ── CI ──────────────────────────────────────────────────────────────────
      verify: {
        command:
          "vp check && vp test && vp run @trendpublish/dashboard#check && vp run @trendpublish/dashboard#test && vp run @trendpublish/dashboard#build",
        cache: false,
      },
    },
  },
});
