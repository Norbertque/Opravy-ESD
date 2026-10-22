import dotenv from 'dotenv';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vytvorApi } from './server/api';

// Šablona AI Studia volá jen dotenv.config(), které čte soubor .env.
// Lokálně ale klíč patří do .env.local (tak to píše i README), proto čteme oba.
// Proměnné, které nastaví AI Studio, mají vždy přednost.
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.disable('x-powered-by');

  app.use('/api', vytvorApi());

  // Data pro pdf.js (znakové sady, standardní písma, dekodéry obrázků) – servírují se přímo z balíčku.
  for (const slozka of ['cmaps', 'standard_fonts', 'wasm']) {
    app.use(`/pdfjs/${slozka}`, express.static(path.join(__dirname, 'node_modules/pdfjs-dist', slozka), { maxAge: '7d', fallthrough: false }));
  }

  // OCR (tesseract.js): worker, jádro a česká jazyková data – také přímo z balíčků.
  const zBalicku = (cesta: string) => path.join(__dirname, 'node_modules', cesta);
  app.get('/tesseract/worker.min.js', (_req, res) => res.sendFile(zBalicku('tesseract.js/dist/worker.min.js')));
  app.use('/tesseract/core', express.static(zBalicku('tesseract.js-core'), { maxAge: '7d', fallthrough: false }));
  app.use('/tesseract/lang', express.static(zBalicku('@tesseract.js-data/ces/4.0.0_best_int'), { maxAge: '7d', fallthrough: false }));

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const bezHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !bezHmr,
        ws: bezHmr ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    // Serverové soubory, skripty a testy nejsou pro prohlížeč – při pre-warmingu v AI Studiu
    // by v nich jinak Vite přebalovalo serverové/nativní balíčky (@napi-rs/canvas, express, playwright…).
    app.use((req, res, next) => {
      if (/^\/(server|scripts|testy)\b|^\/(vite|vitest)\.config\.ts$/.test(req.path)) {
        res.type('application/javascript').send('export {};\n');
        return;
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(__dirname, 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Opravy ESD běží na http://localhost:${PORT}`);
  });
}

startServer();
