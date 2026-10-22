/**
 * /api/podpis       – podpis z Disku podle konfigurace (název nebo ID souboru)
 * /api/podpis/:id   – konkrétní obrázek vybraný uživatelem (když se podle konfigurace nenašel)
 */
import express from 'express';
import { konfigurace } from '../konfigurace';
import { ChybaDisku } from './nastroje/disk';
import { diskZPozadavku } from './nastroje/vyber-disku';

export function routerPodpisu() {
  const router = express.Router();

  router.get('/podpis', async (req, res) => {
    const { disk, poznamka } = diskZPozadavku(req);
    if (poznamka)
      return void res.status(401).json({ kod: 'disk', chyba: 'Pro načtení podpisu se přihlaste ke Google Disku, nebo podpis nahrajte z počítače.' });
    try {
      const vysledek = await disk.najdiPodpis(konfigurace.disk.podpis);
      if ('kandidati' in vysledek)
        return void res.status(404).json({
          chyba: `Podpis „${konfigurace.disk.podpis}“ se na Disku nenašel. Vyberte ho ze seznamu, nebo nahrajte z počítače.`,
          kandidati: vysledek.kandidati.map(({ id, nazev, upraveno }) => ({ id, nazev, upraveno })),
        });
      res.setHeader('X-Nazev', encodeURIComponent(vysledek.soubor.nazev));
      res.setHeader('Cache-Control', 'no-store');
      res.type('image/png').send(vysledek.data);
    } catch (chyba) {
      odpovezChybou(res, chyba);
    }
  });

  router.get('/podpis/:id', async (req, res) => {
    const { disk } = diskZPozadavku(req);
    try {
      const data = await disk.stahniObrazek(req.params.id);
      res.setHeader('Cache-Control', 'no-store');
      res.type('image/png').send(data);
    } catch (chyba) {
      odpovezChybou(res, chyba);
    }
  });

  return router;
}

function odpovezChybou(res: express.Response, chyba: unknown) {
  if (chyba instanceof ChybaDisku) {
    console.warn('Podpis: chyba Disku', chyba.kod);
    return void res.status(chyba.kod === 'prihlaseni' ? 401 : chyba.kod === 'nenalezeno' ? 404 : 502).json({ kod: chyba.kod === 'prihlaseni' ? 'disk' : 'jina', chyba: chyba.message });
  }
  console.error('Podpis: neočekávaná chyba', chyba instanceof Error ? chyba.name : typeof chyba);
  res.status(500).json({ kod: 'jina', chyba: 'Podpis se nepodařilo načíst. Zkuste to znovu.' });
}
