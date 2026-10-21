import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jednoznacnaShoda, najdiText, zjednodus, type PolozkaTextu } from '../src/pdf/hledani';

const DATA = path.resolve(import.meta.dirname, '../testovaci-data');

async function polozkyStrany(soubor: string, strana: number): Promise<PolozkaTextu[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(path.join(DATA, soubor))) }).promise;
  const obsah = await (await doc.getPage(strana)).getTextContent();
  await doc.loadingTask.destroy();
  return obsah.items.filter((i): i is (typeof obsah.items)[number] & PolozkaTextu => 'str' in i);
}

const polozka = (str: string, x: number, y: number, hasEOL = false, velikost = 10): PolozkaTextu => ({
  str,
  transform: [velikost, 0, 0, velikost, x, y],
  width: str.length * velikost * 0.5,
  hasEOL,
});

describe('zjednodušení textu', () => {
  it('sjednotí mezery, nezlomitelné mezery, velikost písmen a pomlčky', () => {
    expect(zjednodus('602 00 Brno')).toBe(zjednodus('602 00 brno'));
    expect(zjednodus('Brno – střed')).toBe(zjednodus('Brno-střed'));
    expect(zjednodus('„text"')).toBe(zjednodus('"text"'));
  });
});

describe('hledání v testovacích PDF', () => {
  it('najde datum v buňce tabulky (ESD 1, strana 1)', async () => {
    const shody = najdiText(await polozkyStrany('esd-1-zaznam.pdf', 1), '14. 5. 1985');
    expect(shody).toHaveLength(1);
    expect(shody[0].useky).toHaveLength(1);
    const u = shody[0].useky[0];
    expect(u.pocatek[0]).toBeCloseTo(196, 0);
    expect(u.pocatek[1]).toBeCloseTo(617, 0);
    expect(u.delka).toBeGreaterThan(45);
  });

  it('najde text pro doplnění („Číslo smlouvy:")', async () => {
    const shody = najdiText(await polozkyStrany('esd-1-zaznam.pdf', 1), 'Číslo smlouvy:');
    expect(shody).toHaveLength(1);
  });

  it('najde adresu přes dva řádky s děleným slovem (ESD 1, strana 2)', async () => {
    const shody = najdiText(await polozkyStrany('esd-1-zaznam.pdf', 2), 'Masarykova 132/45, 602 00 Brno', {
      pred: 'na pobočce Brno-střed,',
      za: '. Klient obdržel',
    });
    expect(shody).toHaveLength(1);
    expect(shody[0].useky).toHaveLength(2);
    expect(shody[0].text).toContain('Masa-');
    // druhý řádek je o 15 bodů níž
    expect(shody[0].useky[0].pocatek[1] - shody[0].useky[1].pocatek[1]).toBeCloseTo(15, 0);
  });

  it('najde text na otočené stránce (ESD 2, strana 1, /Rotate 90)', async () => {
    const shody = najdiText(await polozkyStrany('esd-2-plna-moc.pdf', 1), '401234');
    expect(shody).toHaveLength(1);
    const u = shody[0].useky[0];
    expect(u.smer[0]).toBeCloseTo(0, 5);
    expect(u.smer[1]).toBeCloseTo(1, 5);
    // nahoru = proti ose x (k horní části zobrazené stránky)
    expect(u.nahoru[0]).toBeCloseTo(-1, 5);
  });

  it('najde datum uprostřed dlouhého řádku a úsek nezačíná na začátku řádku', async () => {
    const shody = najdiText(await polozkyStrany('esd-2-plna-moc.pdf', 1), '14. 5. 1985');
    expect(shody).toHaveLength(1);
    expect(shody[0].useky[0].pocatek[1]).toBeGreaterThan(150);
  });

  it('nenajde číslo uvnitř delšího čísla', async () => {
    const polozky = await polozkyStrany('smlouva.pdf', 2);
    expect(najdiText(polozky, '771234567')).toHaveLength(0);
    expect(najdiText(polozky, '7712345678')).toHaveLength(1);
  });
});

describe('hledání v uměle sestavených položkách', () => {
  it('ponechá spojovník u složeniny rozdělené na konci řádku', () => {
    const polozky = [polozka('pobočka Brno-', 50, 700, true), polozka('střed, Masarykova', 50, 685)];
    expect(najdiText(polozky, 'Brno-střed')).toHaveLength(1);
  });

  it('spojí slovo rozdělené spojovníkem a nezlomitelné mezery', () => {
    const polozky = [polozka('na pobočce Masa-', 50, 700, true), polozka('rykova 132/45, 602 00 Brno.', 50, 685)];
    const shody = najdiText(polozky, 'Masarykova 132/45, 602 00 Brno');
    expect(shody).toHaveLength(1);
    expect(shody[0].useky).toHaveLength(2);
  });

  it('spojí slova rozdělená do více položek na jednom řádku do jednoho úseku', () => {
    const polozky = [polozka('Datum', 50, 700), polozka('14.', 100, 700), polozka('5.', 118, 700), polozka('1985', 130, 700)];
    const shody = najdiText(polozky, '14. 5. 1985');
    expect(shody).toHaveLength(1);
    expect(shody[0].useky).toHaveLength(1);
    expect(shody[0].useky[0].pocatek[0]).toBe(100);
    expect(shody[0].useky[0].delka).toBe(130 + 20 - 100);
  });

  it('podle kontextu vybere správný z více výskytů, bez kontextu nevybere žádný', () => {
    const polozky = [
      polozka('Zmocnitel nar. 14. 5. 1985, bytem', 50, 700, true),
      polozka('Zmocněnec nar. 14. 5. 1985, sídlem', 50, 680),
    ];
    expect(jednoznacnaShoda(najdiText(polozky, '14. 5. 1985'))).toBeNull();
    const shoda = jednoznacnaShoda(najdiText(polozky, '14. 5. 1985', { za: ', sídlem' }));
    expect(shoda?.useky[0].pocatek[1]).toBe(680);
  });
});
