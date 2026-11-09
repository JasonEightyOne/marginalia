import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: 'es2020' } },
});
