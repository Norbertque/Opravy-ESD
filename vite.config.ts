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
  optimizeDeps: {
    // pdf.js a tesseract.js mají vlastní workery – nepřebalovat.
    exclude: ['pdfjs-dist', 'tesseract.js'],
  },
});
