import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts-vendor';
          if (id.includes('@supabase')) return 'supabase-vendor';
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) {
            return 'react-vendor';
          }
          if (id.includes('lucide-react')) return 'icons-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    // Canlı veri sunucusu (server/index.js) ayrı portta çalışır;
    // frontend /api isteklerini oraya yönlendirir.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
