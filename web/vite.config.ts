import { resolve } from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom", "@tanstack/react-query", "recharts"],
  },
  optimizeDeps: {
    // Shell ships TypeScript source; serve it as source so every entry point
    // shares one module graph, and pre-bundle the CommonJS shims it reaches.
    exclude: ["@zsrobinson/shell"],
    include: [
      "use-sync-external-store/shim",
      "use-sync-external-store/shim/with-selector",
      "recharts",
    ],
  },
  server: {
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 8787}` },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return
          if (id.includes("recharts") || id.includes("d3-")) return "charts"
          if (id.includes("@base-ui") || id.includes("@floating-ui"))
            return "base-ui"
          if (id.includes("@tanstack")) return "tanstack"
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
            return "react"
        },
      },
    },
  },
})
