/**
 * Test kroku 4 (MOCK_GEMINI=1, MOCK_DISK=1): schválení, podpis z test-drive, vytvoření
 * opravených PDF a jejich KONTROLA:
 *  - škrt sedí přesně na chybném textu (±1 bod oproti přesné poloze z generátoru),
 *  - oprava ani podpis se nepřekrývají s textem ani čarami originálu,
 *  - čeština jde z opraveného PDF přečíst,
 *  - originály v prohlížeči zůstaly beze změny, ZIP obsahuje oba soubory.
 *
 * Spuštění (appka musí běžet): npx tsx testy/e2e/krok4-export.ts
 */
import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { Usek } from '../../src/pdf/hledani';
import { boxPolozky, obrazky, otevri, podilTmavych, polozky, prekryvaSe, vyrenderuj, zmerSkrt, type Box } from './analyza-pdf';
import { DATA, hlidejChyby, KOREN, NOTEBOOK, over, snimek, spustProhlizec, VYSTUPY, zalozIntervenci } from './prohlizec';

const NBSP = ' ';
const TEXT = await fs.readFile(path.join(DATA, 'intervence.txt'), 'utf8');
const OPRAVA_ADRESY = 'Masarykova 123/45, 602 00 Brno-střed';

// Přesné šířky textu v písmu testovacích dokumentů (stejné jako v generátoru)
const pomocny = await PDFDocument.create();
pomocny.registerFontkit(fontkit);
const pismo = await pomocny.embedFont(await fs.readFile(path.join(KOREN, 'public/fonty/NotoSans-Regular.ttf')));
const sirka = (t: string, s: number) => pismo.widthOfTextAtSize(t, s);
const vodorovne = (x: number, y: number, delka: number, velikost: number): Usek => ({
  pocatek: [x, y], smer: [1, 0], nahoru: [0, 1], delka, velikost,
});
const otocene = (ucari: number, od: number, delka: number, velikost: number): Usek => ({
  pocatek: [ucari, od], smer: [0, 1], nahoru: [-1, 0], delka, velikost,
});

/** Očekávané škrty: soubor, strana, úsek. */
/** `jinaDelka`: škrt může skončit i jinde (např. před spojovníkem dělení slova). */
const OCEKAVANE_SKRTY: { popis: string; soubor: string; strana: number; usek: Usek; jinaDelka?: number }[] = [
  { popis: 'datum v tabulce (ESD 1)', soubor: 'esd-1-zaznam', strana: 1, usek: vodorovne(196, 617, sirka('14. 5. 1985', 10.5), 10.5) },
  {
    popis: 'adresa, 1. řádek „Masa-" (ESD 1)',
    soubor: 'esd-1-zaznam',
    strana: 2,
    usek: vodorovne(60 + sirka('Jednání proběhlo dne 20. 3. 2026 na pobočce Brno-střed, ', 10.5), 770, sirka('Masa-', 10.5), 10.5),
    jinaDelka: sirka('Masa', 10.5),
  },
  {
    popis: 'adresa, 2. řádek (ESD 1)',
    soubor: 'esd-1-zaznam',
    strana: 2,
    usek: vodorovne(60, 755, sirka(`rykova 132/45, 602${NBSP}00 Brno`, 10.5), 10.5),
  },
  {
    popis: 'datum uprostřed řádku na otočené straně (ESD 2)',
    soubor: 'esd-2-plna-moc',
    strana: 1,
    usek: otocene(130, 70 + sirka('Zmocnitel: Jan Testovací, nar. ', 11), sirka('14. 5. 1985', 11), 11),
  },
  {
    popis: 'získatelské číslo na konci řádku (ESD 2)',
    soubor: 'esd-2-plna-moc',
    strana: 1,
    usek: otocene(160, 70 + sirka('Zmocněnec: Petra Ukázková, zprostředkovatelka pojišťovny Vzorník a.s., získatelské číslo ', 11), sirka('401234', 11), 11),
  },
];

const OCEKAVANE_TEXTY: Record<string, { strana: number; text: string }[]> = {
  'esd-1-zaznam': [
    { strana: 1, text: '14. 5. 1983' },
    { strana: 1, text: '7712345678' },
    { strana: 2, text: OPRAVA_ADRESY },
  ],
  'esd-2-plna-moc': [
    { strana: 1, text: '14. 5. 1983' },
    { strana: 1, text: '401243' },
  ],
};

const prohlizec = await spustProhlizec();
try {
  const kontext = await prohlizec.newContext({ viewport: NOTEBOOK, acceptDownloads: true });
  const stranka = await kontext.newPage();
  const chyby = hlidejChyby(stranka);

  console.log('Příprava: dohledání a schválení');
  await zalozIntervenci(stranka, { esd: ['esd-1-zaznam.pdf', 'esd-2-plna-moc.pdf'], text: TEXT });
  await stranka.getByRole('button', { name: 'Spustit dohledání' }).click();
  await stranka.getByText('Nalezeno 5 bodů').waitFor({ timeout: 30_000 });
  await stranka.getByRole('button', { name: /Pokračovat ke schvalování/ }).click();
  await stranka.getByRole('button', { name: 'Schválit vše (4)' }).click();
  const bod4 = stranka.getByRole('article', { name: 'Bod 4' });
  await bod4.getByRole('button', { name: 'Zrušit schválení' }).click();
  await bod4.getByRole('button', { name: 'Upravit' }).click();
  await bod4.getByLabel('Oprava').fill(OPRAVA_ADRESY);
  await bod4.getByRole('button', { name: 'Uložit' }).click();
  await bod4.getByRole('button', { name: 'Schválit' }).click();
  await stranka.getByText('Schváleno 4 z 4 bodů').waitFor();
  await stranka.getByRole('button', { name: /Pokračovat ke stažení/ }).click();

  console.log('Podpis a vytvoření PDF');
  await stranka.getByText('z Google Disku: podpis.png').waitFor({ timeout: 30_000 });
  over(true, 'podpis se načetl z Disku (test-drive) podle konfigurace');
  await stranka.getByRole('button', { name: 'Vytvořit opravená PDF' }).click();
  await stranka.getByRole('heading', { name: 'Hotovo' }).waitFor({ timeout: 60_000 });
  const zprava = await stranka.locator('section', { hasText: 'Hotovo' }).innerText();
  console.log(zprava.split('\n').filter((r) => r.startsWith('Bod')).map((r) => `    ${r}`).join('\n'));
  over(!zprava.includes('nenašlo se volné místo'), 'všechny opravy mají volné místo');
  await stranka.waitForTimeout(1500);
  await snimek(stranka, 'krok4-export');

  console.log('Stažení');
  const slozka = path.join(VYSTUPY, 'export');
  await fs.mkdir(slozka, { recursive: true });
  const stazene: Record<string, Uint8Array> = {};
  for (const tlacitko of await stranka.getByRole('button', { name: 'Stáhnout', exact: true }).all()) {
    const [stazeni] = await Promise.all([stranka.waitForEvent('download'), tlacitko.click()]);
    const cil = path.join(slozka, stazeni.suggestedFilename());
    await stazeni.saveAs(cil);
    stazene[stazeni.suggestedFilename()] = new Uint8Array(await fs.readFile(cil));
  }
  over(Object.keys(stazene).sort().join(',') === 'esd-1-zaznam_opraveno.pdf,esd-2-plna-moc_opraveno.pdf', 'soubory se jmenují <název>_opraveno.pdf');
  const [zipStazeni] = await Promise.all([stranka.waitForEvent('download'), stranka.getByRole('button', { name: /Stáhnout vše \(ZIP\)/ }).click()]);
  const zip = await JSZip.loadAsync(await fs.readFile(await zipStazeni.path()));
  over(Object.keys(zip.files).length === 2, `ZIP obsahuje oba soubory (${zipStazeni.suggestedFilename()})`);

  console.log('Originály v prohlížeči');
  // Funkce jako text: tsx by do funkce vložil pomocnou __name, kterou prohlížeč nezná.
  const hashe: string[] = await stranka.evaluate(`(async () => {
    const db = await new Promise((hotovo) => { const r = indexedDB.open('opravy-esd'); r.onsuccess = () => hotovo(r.result); });
    const vse = await new Promise((hotovo) => { const r = db.transaction('soubory').objectStore('soubory').getAll(); r.onsuccess = () => hotovo(r.result); });
    const vysledek = [];
    for (const s of vse) {
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', await s.data.arrayBuffer()));
      vysledek.push(Array.from(h, (x) => x.toString(16).padStart(2, '0')).join(''));
    }
    return vysledek;
  })()`);
  for (const nazev of ['smlouva.pdf', 'esd-1-zaznam.pdf', 'esd-2-plna-moc.pdf']) {
    const h = crypto.createHash('sha256').update(await fs.readFile(path.join(DATA, nazev))).digest('hex');
    over(hashe.includes(h), `${nazev} je v prohlížeči beze změny`);
  }

  console.log('Kontrola opravených PDF');
  for (const zaklad of ['esd-1-zaznam', 'esd-2-plna-moc']) {
    const original = await otevri(new Uint8Array(await fs.readFile(path.join(DATA, `${zaklad}.pdf`))));
    const opraveny = await otevri(stazene[`${zaklad}_opraveno.pdf`]);
    for (const cislo of [1, 2]) {
      const renderOrig = await vyrenderuj(original, cislo);
      const renderOprav = await vyrenderuj(opraveny, cislo);
      const puvodni = await polozky(original, cislo);
      const klicPolozky = (p: { str: string; transform: number[] }) => `${p.str}|${p.transform.map((n) => n.toFixed(2)).join(',')}`;
      const puvodniKlice = new Set(puvodni.map(klicPolozky));
      const nove = (await polozky(opraveny, cislo)).filter((p) => !puvodniKlice.has(klicPolozky(p)));

      // škrty
      for (const o of OCEKAVANE_SKRTY.filter((x) => x.soubor === zaklad && x.strana === cislo)) {
        const m = zmerSkrt(renderOprav, o.usek);
        over(m, `${o.popis}: škrt je na místě`);
        const odchylkaKonce = Math.min(
          Math.abs(m!.konec - o.usek.delka),
          o.jinaDelka === undefined ? Infinity : Math.abs(m!.konec - o.jinaDelka),
        );
        const odchylka = Math.max(Math.abs(m!.zacatek), odchylkaKonce);
        over(odchylka <= 1.5, `${o.popis}: škrt sedí na textu (odchylka ${odchylka.toFixed(2)} b)`);
        over(m!.vyska > 0.2 * o.usek.velikost && m!.vyska < 0.45 * o.usek.velikost, `${o.popis}: škrt vede středem textu`);
      }

      // nové texty: oprava je čitelná (i s háčky) a nic nepřekrývá
      for (const o of OCEKAVANE_TEXTY[zaklad].filter((x) => x.strana === cislo)) {
        const nalezene = nove.filter((p) => p.str.includes(o.text));
        over(nalezene.length > 0, `${zaklad} str. ${cislo}: oprava „${o.text}" je v PDF jako text`);
      }
      const prekazky: Box[] = puvodni.map(boxPolozky);
      const noveBoxy: { co: string; box: Box }[] = [
        ...nove.map((p) => ({ co: `text „${p.str}"`, box: boxPolozky(p) })),
        ...(await obrazky(opraveny, cislo)).map((b) => ({ co: 'podpis', box: b })),
      ];
      for (const { co, box } of noveBoxy) {
        over(!prekazky.some((p) => prekryvaSe(box, p, 0.2)), `${zaklad} str. ${cislo}: ${co} nepřekrývá původní text`);
        const tmave = podilTmavych(renderOrig, box);
        over(tmave < 0.002, `${zaklad} str. ${cislo}: ${co} leží na prázdném místě (tmavé pixely ${(tmave * 100).toFixed(2)} %)`);
      }
      for (let i = 0; i < noveBoxy.length; i++)
        for (let j = i + 1; j < noveBoxy.length; j++)
          over(!prekryvaSe(noveBoxy[i].box, noveBoxy[j].box, 0.2), `${zaklad} str. ${cislo}: ${noveBoxy[i].co} a ${noveBoxy[j].co} se nepřekrývají`);
    }
    await original.loadingTask.destroy();
    await opraveny.loadingTask.destroy();
  }

  console.log('Dokončit a smazat');
  stranka.once('dialog', (d) => void d.accept());
  await stranka.getByRole('button', { name: 'Dokončit a smazat' }).click();
  await stranka.waitForURL(/#\/$/);
  over(true, 'po dokončení je appka zpět na seznamu');

  over(chyby.length === 0, `v konzoli prohlížeče nejsou chyby${chyby.length ? ': ' + chyby.join(' | ') : ''}`);
  console.log('\nKrok 4: vše v pořádku.');
} finally {
  await prohlizec.close();
}
