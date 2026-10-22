import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  worker: { format: "es" },
  // onnxruntime-web's WASM loader breaks under Vite's dep pre-bundling.
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
