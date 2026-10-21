import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { najdiText, type PolozkaTextu } from '../src/pdf/hledani';
import { obdelnikUseku, usekZObdelniku } from '../src/schvalovani/geometrie';

const DATA = path.resolve(import.meta.dirname, '../testovaci-data');

async function strana(soubor: string, cislo: number, meritko = 1) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(path.join(DATA, soubor))) }).promise;
  const s = await doc.getPage(cislo);
  const obsah = await s.getTextContent();
  const polozky = obsah.items.filter((i): i is (typeof obsah.items)[number] & PolozkaTextu => 'str' in i);
  return { viewport: s.getViewport({ scale: meritko }), polozky, view: s.view, rotate: s.rotate };
}

describe('převod souřadnic pdf.js ↔ stránka PDF (pdf-lib)', () => {
  it('stránka s ořezem (CropBox): obdélník v náhledu je posunutý o začátek ořezu', async () => {
    const { viewport, polozky, view } = await strana('esd-1-zaznam.pdf', 1);
    expect(view).toEqual([25, 35, 545.28, 776.89]);
    const u = najdiText(polozky, '14. 5. 1985')[0].useky[0];
    const o = obdelnikUseku(u, viewport);
    expect(o.left).toBeCloseTo(196 - 25, 1);
    expect(o.top).toBeCloseTo(776.89 - (617 + 0.85 * 10.5), 1);
    expect(o.width).toBeCloseTo(u.delka, 1);
  });

  it('obdélník → úsek → obdélník vrátí totéž (i se dvojnásobným zvětšením)', async () => {
    const { viewport, polozky } = await strana('esd-1-zaznam.pdf', 1, 2);
    const u = najdiText(polozky, '14. 5. 1985')[0].useky[0];
    const zpet = usekZObdelniku(obdelnikUseku(u, viewport), viewport, polozky);
    expect(zpet.pocatek[0]).toBeCloseTo(u.pocatek[0], 1);
    expect(zpet.pocatek[1]).toBeCloseTo(u.pocatek[1], 1);
    expect(zpet.delka).toBeCloseTo(u.delka, 1);
    expect(zpet.velikost).toBeCloseTo(u.velikost, 1);
  });

  it('otočená stránka (/Rotate 90): text je v náhledu vodorovně, úsek z obdélníku má směr textu', async () => {
    const { viewport, polozky, rotate } = await strana('esd-2-plna-moc.pdf', 1);
    expect(rotate).toBe(90);
    const u = najdiText(polozky, '401234')[0].useky[0];
    const o = obdelnikUseku(u, viewport);
    expect(o.width).toBeGreaterThan(o.height);
    // displej: X = y stránky, Y = x stránky (viz generátor testovacích dat)
    expect(o.left).toBeCloseTo(u.pocatek[1], 1);
    const zpet = usekZObdelniku(o, viewport, polozky);
    expect(zpet.smer[0]).toBeCloseTo(0, 5);
    expect(zpet.smer[1]).toBeCloseTo(1, 5);
    expect(zpet.nahoru[0]).toBeCloseTo(-1, 5);
    expect(zpet.pocatek[0]).toBeCloseTo(u.pocatek[0], 1);
    expect(zpet.pocatek[1]).toBeCloseTo(u.pocatek[1], 1);
  });

  it('obdélník mimo text: škrt vede středem obdélníku', async () => {
    const { viewport } = await strana('esd-2-plna-moc.pdf', 2);
    const u = usekZObdelniku({ left: 100, top: 200, width: 80, height: 20 }, viewport, []);
    const stredY = 792 - 210; // Letter, bez ořezu a otočení
    const vyskaSkrtu = u.pocatek[1] + 0.33 * u.velikost;
    expect(Math.abs(vyskaSkrtu - stredY)).toBeLessThan(2);
    expect(u.delka).toBeCloseTo(80, 5);
  });
});
