import express, { type NextFunction, type Request, type Response } from 'express';
import { konfigurace } from '../konfigurace';
import { rezim } from './rezim';

/**
 * Všechny serverové adresy appky (/api/...).
 *
 * Pravidlo: obsah dokumentů se na serveru nikam neukládá ani neloguje.
 * Do logu jde jen druh chyby, nikdy text ze smlouvy, ESD nebo intervence.
 */
export function vytvorApi() {
  const api = express.Router();

  api.get('/stav', (_req, res) => {
    res.json({
      model: konfigurace.gemini.model,
      klicNastaven: Boolean(process.env.GEMINI_API_KEY),
      mockGemini: rezim.mockGemini,
      mockDisk: rezim.mockDisk,
    });
  });

  api.use((_req, res) => {
    res.status(404).json({ chyba: 'Neznámá adresa API.' });
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Chyba API:', err instanceof Error ? err.name : typeof err);
    res.status(500).json({ chyba: 'Na serveru došlo k neočekávané chybě. Zkuste to znovu.' });
  });

  return api;
}
