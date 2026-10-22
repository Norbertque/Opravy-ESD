import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  server: {
    // AI Studio vypíná HMR proměnnou DISABLE_HMR, aby se stránka při úpravách agentem neblikala.
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
  build: {
    // pdf.js a pdf-lib jsou velké knihovny; appka běží na notebooku, ne na mobilních datech.
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    entries: ['index.html'],
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'lucide-react',
      'idb',
      'jszip',
      'pdf-lib',
      '@pdf-lib/fontkit',
      'tesseract.js',
    ],
    // pdf.js má vlastní worker – nepřebalovat. (tesseract.js je CommonJS, ten se přebalit musí.)
    exclude: ['pdfjs-dist'],
  },
});
