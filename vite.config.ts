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
      dev: {
        command: "node scripts/trendpublish.mjs dev",
        cache: false,
      },
      "dev:api": {
        command: "vp run @trendpublish/server#dev",
        cache: false,
      },
      "dev:dashboard": {
        command: "vp run @trendpublish/dashboard#dev",
        cache: false,
      },
      trend: {
        command: "node scripts/trendpublish.mjs",
        cache: false,
      },
      doctor: { command: "vp exec tsx scripts/doctor.ts" },
      relay: {
        command: "vp run @trendpublish/server#relay",
        cache: false,
      },
      "relay:systemd": {
        command: "vp exec tsx scripts/print-relay-systemd.ts",
        cache: false,
      },
      "relay:install": {
        command: "vp exec tsx scripts/install-relay-systemd.ts",
        cache: false,
      },
      docker: { command: "node scripts/trendpublish.mjs docker", cache: false },
      "docker:relay": {
        command: "node scripts/trendpublish.mjs docker relay",
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
      "cf:dev": { command: "vp exec wrangler dev", cache: false },
      "cf:migrate": {
        command: "vp exec wrangler d1 migrations apply ARTICLE_DB --remote",
        cache: false,
      },
      "cf:migrate:local": {
        command: "vp exec wrangler d1 migrations apply ARTICLE_DB --local",
        cache: false,
      },
      "cf:sync-secrets": {
        command: "vp exec tsx scripts/cloudflare-sync-secrets.ts",
        cache: false,
      },
      "cf:smoke": {
        command: "vp exec tsx scripts/cloudflare-smoke.ts",
        cache: false,
      },
      "docs:dev": {
        command: "vp exec vitepress dev docs",
        cache: false,
      },
      "docs:build": {
        command: "vp exec vitepress build docs",
        input: ["docs/**", "package.json", "pnpm-lock.yaml"],
      },
      verify: {
        command:
          "vp check && vp test && vp run @trendpublish/dashboard#check && vp run @trendpublish/dashboard#test && vp run @trendpublish/dashboard#build",
        cache: false,
      },
    },
  },
});
