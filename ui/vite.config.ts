import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/spy': {
        target: 'http://localhost:7860',
        changeOrigin: true,
      },
      '/api': {
        target: 'https://shmulc-hebrew-codenames-copilot.hf.space',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
