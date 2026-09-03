/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],

  // base.html·엔진 소스를 ?raw 로 인라인한다 — 산출물은 네트워크 없이 만들어져야 한다
  build: { chunkSizeWarningLimit: 2048 },

  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },

  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1422 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // 엔진 소스는 vendor/ 에 있다 — 프로젝트 루트 안이지만 명시해 둔다
    fs: { allow: [".."] },
  },
}));
