import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Canlı veri sunucusu (server/index.js) ayrı portta çalışır;
    // frontend /api isteklerini oraya yönlendirir.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
