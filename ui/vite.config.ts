import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
