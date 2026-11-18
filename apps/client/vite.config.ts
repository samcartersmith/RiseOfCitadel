import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      // Multi-page build: the game plus dev sandboxes (served at /anim.html, /units.html, /vfx.html).
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        anim: fileURLToPath(new URL('./anim.html', import.meta.url)),
        units: fileURLToPath(new URL('./units.html', import.meta.url)),
        vfx: fileURLToPath(new URL('./vfx.html', import.meta.url)),
      },
      output: {
        // Keep Babylon in its own long-cached chunk.
        manualChunks: (id) => (id.includes('@babylonjs') ? 'babylon' : undefined),
      },
    },
  },
});
