import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png"],
      manifest: {
        name: "AI Engineering Companion",
        short_name: "AI Engineering",
        description: "Private engineering study workspace with grounded AI tutoring, document retrieval and evidence-based mastery.",
        theme_color: "#070a16",
        background_color: "#070a16",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        categories: ["education", "productivity"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Ask the AI Tutor", short_name: "Tutor", url: "/tutor", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
          { name: "Knowledge Base", short_name: "Documents", url: "/documents", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          { urlPattern: /^https?:\/\/.*\/api\//, handler: "NetworkOnly" },
          {
            urlPattern: ({ request }: { request: Request }) => ["image", "font", "style", "script"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "aec-static", expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    globals: true,
  },
});
