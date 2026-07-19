import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "#components",
        replacement: fileURLToPath(new URL("./src/components", import.meta.url)),
      },
      {
        find: "#hooks",
        replacement: fileURLToPath(new URL("./src/hooks", import.meta.url)),
      },
      {
        find: "#lib",
        replacement: fileURLToPath(new URL("./src/lib", import.meta.url)),
      },
      {
        find: "#platform",
        replacement: fileURLToPath(new URL("./src/platform", import.meta.url)),
      },
    ],
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["@gsap/react", "gsap", "gsap/ScrollTrigger"],
  },
  build: {
    outDir: "../../dist/dashboard",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    hmr: {
      clientPort: 5173,
    },
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
