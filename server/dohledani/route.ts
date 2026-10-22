/**
 * /api/dohledani      – spustí dohledání, průběh posílá jako proud řádků JSON (NDJSON)
 * /api/gemini-soubor  – nahraje jeden velký soubor do Files API (vrátí odkaz)
 *
 * Soubory jsou jen v paměti po dobu dotazu, nikam se neukládají ani nelogují.
 */
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { konfigurace } from '../../konfigurace';
import type { KodChyby, UdalostDohledani } from '../../src/sdilene/dohledani';
import { ChybaDisku } from '../nastroje/disk';
import { diskZPozadavku } from '../nastroje/vyber-disku';
import { rezim } from '../rezim';
import { dohledej } from './dohledej';
import { ChybaModelu, HLASKY, type ModelKlient } from './model';
import { modelGemini } from './model-gemini';
import { modelMock } from './model-mock';
import { sestavVstupy, type NahranySoubor, type RoleSouboru } from './vstupy';

const MAX_SOUBOR = 50 * 1024 * 1024;

export function vyberModel(): ModelKlient {
  if (rezim.mockGemini) return modelMock();
  const klic = process.env.GEMINI_API_KEY;
  if (!klic || klic === 'MY_GEMINI_API_KEY') throw new ChybaModelu('klic', HLASKY.klic);
  return modelGemini(klic);
}

interface Zadani {
  textIntervence: string;
  soubory: {
    pole: string | null;
    role: RoleSouboru;
    nazev: string;
    mimeType: string;
    nahrano: { uri: string; mimeType: string; name: string } | null;
  }[];
}

export function routerDohledani() {
  const router = express.Router();
  const nahrani = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SOUBOR, files: 40 } });

  router.post('/gemini-soubor', express.raw({ type: () => true, limit: MAX_SOUBOR }), async (req, res) => {
    try {
      const model = vyberModel();
      const nazev = decodeURIComponent(String(req.headers['x-nazev'] ?? 'soubor'));
      const mimeType = String(req.headers['content-type'] ?? 'application/pdf');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0)
        return void res.status(400).json({ kod: 'vstup', chyba: 'Soubor je prázdný.' });
      res.json(await model.nahrajSoubor(req.body, mimeType, nazev));
    } catch (chyba) {
      const { kod, zprava } = prelozChybu(chyba);
      res.status(kod === 'klic' ? 500 : 502).json({ kod, chyba: zprava });
    }
  });

  router.post('/dohledani', nahrani.any() as unknown as express.RequestHandler, async (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const posli = (u: UdalostDohledani) => {
      if (!res.writableEnded) res.write(JSON.stringify(u) + '\n');
    };

    const preruseni = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) preruseni.abort();
    });

    const nahraneDoFiles: string[] = [];
    let model: ModelKlient | null = null;
    try {
      model = vyberModel();
      const zadani = JSON.parse(String(req.body?.zadani ?? '{}')) as Zadani;
      const prijate = (req.files ?? []) as Express.Multer.File[];
      const soubory: NahranySoubor[] = [];
      for (const s of zadani.soubory ?? []) {
        if (s.nahrano) {
          nahraneDoFiles.push(s.nahrano.name);
          soubory.push({ role: s.role, nazev: s.nazev, mimeType: s.nahrano.mimeType, uri: s.nahrano.uri });
          continue;
        }
        const data = prijate.find((f) => f.fieldname === s.pole)?.buffer;
        if (!data) throw new ChybaModelu('vstup', `Soubor „${s.nazev}" nedorazil na server. Zkuste to znovu.`);
        soubory.push({ role: s.role, nazev: s.nazev, mimeType: s.mimeType, data });
      }
      const esd = soubory.filter((s) => s.role === 'esd');
      if (soubory.filter((s) => s.role === 'smlouva').length !== 1 || esd.length === 0)
        throw new ChybaModelu('vstup', 'Chybí smlouva nebo ESD. Vraťte se ke kroku Nahrání.');
      if (!zadani.textIntervence?.trim() && !soubory.some((s) => s.role === 'priloha'))
        throw new ChybaModelu('vstup', 'Chybí text intervence. Vraťte se ke kroku Nahrání.');

      // Velké soubory, které nepřišly předem nahrané, nahraje do Files API server.
      for (const s of soubory) {
        if (s.data && s.data.length > konfigurace.gemini.inlineLimitMB * 1024 * 1024) {
          posli({ typ: 'prubeh', text: `Nahrávám velký soubor „${s.nazev}"…` });
          const odkaz = await model.nahrajSoubor(s.data, s.mimeType, s.nazev);
          nahraneDoFiles.push(odkaz.name);
          s.uri = odkaz.uri;
          s.data = undefined;
        }
      }

      const { disk, poznamka } = diskZPozadavku(req);
      if (poznamka) posli({ typ: 'prubeh', text: poznamka });

      const vysledek = await dohledej({
        model,
        disk,
        vstup: await sestavVstupy(soubory, zadani.textIntervence ?? ''),
        nazvyEsd: esd.map((s) => s.nazev),
        prubeh: (text) => posli({ typ: 'prubeh', text }),
        signal: preruseni.signal,
      });
      posli({ typ: 'vysledek', vysledek });
    } catch (chyba) {
      if (!preruseni.signal.aborted) posli({ typ: 'chyba', ...prelozChybu(chyba) });
    } finally {
      for (const name of nahraneDoFiles) await model?.smazSoubor(name).catch(() => {});
      res.end();
    }
  });

  return router;
}

/** Chyba → kód a česká zpráva. Do logu jde jen druh chyby, nikdy obsah dokumentů. */
export function prelozChybu(chyba: unknown): { kod: KodChyby; zprava: string } {
  if (chyba instanceof ChybaModelu) {
    console.warn('Dohledání: chyba', chyba.kod);
    return { kod: chyba.kod, zprava: chyba.message };
  }
  if (chyba instanceof ChybaDisku) {
    console.warn('Dohledání: chyba Disku', chyba.kod);
    return { kod: chyba.kod === 'prihlaseni' ? 'disk' : 'jina', zprava: chyba.message };
  }
  console.error('Dohledání: neočekávaná chyba', chyba instanceof Error ? chyba.name : typeof chyba);
  return { kod: 'jina', zprava: HLASKY.jina };
}
