import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Build straight into the Space deploy bundle. emptyOutDir clears old hashed assets so a
  // stale index-*.js can never linger next to the new one. `make deploy` relies on this.
  build: {
    outDir: '../hf_space/webapp',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://shmulc-hebrew-codenames-copilot.hf.space',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
