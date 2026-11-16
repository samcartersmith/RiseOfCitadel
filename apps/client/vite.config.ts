import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        // Keep Babylon in its own long-cached chunk.
        manualChunks: (id) => (id.includes('@babylonjs') ? 'babylon' : undefined),
      },
    },
  },
});
