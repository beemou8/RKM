import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import 'dotenv/config';

// Port diambil dari .env (variabel PORT). Kalau tidak diset, baru fallback ke 3000.
const PORT = parseInt(process.env.PORT || '3000', 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: PORT,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://localhost:${PORT}`,
        changeOrigin: true,
      },
    },
  },
});
