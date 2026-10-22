/**
 * Test kroku 5 (MOCK_GEMINI=1, MOCK_DISK=1): ESD 2 je naskenované (jen obrázky, bez textu).
 * Místa výskytů se musí najít přes OCR (tesseract.js, čeština), opravy se zakreslí
 * a ve výsledném PDF se změří, že škrty sedí na textu skenu a nic se nepřekrývá.
 *
 * Spuštění (appka musí běžet): npx tsx testy/e2e/krok5-ocr.ts
 */
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { Usek } from '../../src/pdf/hledani';
import { obrazky, otevri, podilTmavych, polozky, prekryvaSe, vyrenderuj, zmerSkrt, boxPolozky } from './analyza-pdf';
import { DATA, hlidejChyby, KOREN, NOTEBOOK, over, snimek, spustProhlizec, VYSTUPY, zalozIntervenci } from './prohlizec';

const TEXT = await fs.readFile(path.join(DATA, 'intervence.txt'), 'utf8');

const pomocny = await PDFDocument.create();
pomocny.registerFontkit(fontkit);
const pismo = await pomocny.embedFont(await fs.readFile(path.join(KOREN, 'public/fonty/NotoSans-Regular.ttf')));
const sirka = (t: string, s: number) => pismo.widthOfTextAtSize(t, s);

/**
 * Úsek na skenu plné moci: v originále je strana otočená (/Rotate 90), zobrazený bod (X, Y)
 * je ve skenu natočený o 0,25° kolem středu (viz generátor) a sken stránku už neotáčí.
 */
function usekNaSkenu(X: number, Y: number, delka: number, velikost: number): Usek {
  const S = 841.89;
  const V = 595.28;
  const uhel = (0.25 * Math.PI) / 180;
  const [c, s] = [Math.cos(uhel), Math.sin(uhel)];
  const [cx, cy] = [S / 2, V / 2];
  const Xr = cx + c * (X - cx) - s * (Y - cy);
  const Yr = cy + s * (X - cx) + c * (Y - cy);
  return { pocatek: [Xr, V - Yr], smer: [c, -s], nahoru: [s, c], delka, velikost };
}

const SKRTY = [
  { popis: 'datum uprostřed řádku', usek: usekNaSkenu(70 + sirka('Zmocnitel: Jan Testovací, nar. ', 11), 130, sirka('14. 5. 1985', 11), 11) },
  {
    popis: 'získatelské číslo',
    usek: usekNaSkenu(70 + sirka('Zmocněnec: Petra Ukázková, zprostředkovatelka pojišťovny Vzorník a.s., získatelské číslo ', 11), 160, sirka('401234', 11), 11),
  },
];

const prohlizec = await spustProhlizec();
try {
  const stranka = await (await prohlizec.newContext({ viewport: NOTEBOOK, acceptDownloads: true })).newPage();
  const chyby = hlidejChyby(stranka);

  console.log('Dohledání a hledání míst přes OCR');
  await zalozIntervenci(stranka, { esd: ['esd-1-zaznam.pdf', 'esd-2-plna-moc-sken.pdf'], text: TEXT });
  await stranka.getByRole('button', { name: 'Spustit dohledání' }).click();
  await stranka.getByText('Nalezeno 5 bodů').waitFor({ timeout: 30_000 });
  await stranka.getByRole('button', { name: /Pokračovat ke schvalování/ }).click();
  const zacatek = Date.now();
  await stranka.getByText('Rozpoznávám text na skenu').waitFor({ timeout: 30_000 });
  over(true, 'appka hlásí rozpoznávání textu na skenu');
  await stranka.getByRole('button', { name: /Schválit vše/ }).waitFor({ timeout: 240_000 });
  console.log(`    (OCR a hledání míst trvalo ${Math.round((Date.now() - zacatek) / 1000)} s)`);
  over(await stranka.getByText('Text se v PDF nenašel').count() === 0, 'všechny výskyty se našly, i na skenu');
  await stranka.getByRole('button', { name: 'Schválit vše (4)' }).click();
  await snimek(stranka, 'krok5-schvalovani');

  console.log('Export');
  await stranka.getByRole('button', { name: /Pokračovat ke stažení/ }).click();
  await stranka.getByText('z Google Disku: podpis.png').waitFor({ timeout: 30_000 });
  await stranka.getByRole('button', { name: 'Vytvořit opravená PDF' }).click();
  await stranka.getByRole('heading', { name: 'Hotovo' }).waitFor({ timeout: 120_000 });
  const zprava = await stranka.locator('section', { hasText: 'Hotovo' }).innerText();
  over(!zprava.includes('nenašlo se volné místo'), 'všechny opravy mají volné místo');
  const tlacitka = await stranka.getByRole('button', { name: 'Stáhnout', exact: true }).all();
  let data: Uint8Array | null = null;
  for (const t of tlacitka) {
    const [stazeni] = await Promise.all([stranka.waitForEvent('download'), t.click()]);
    if (stazeni.suggestedFilename() === 'esd-2-plna-moc-sken_opraveno.pdf') {
      const cil = path.join(VYSTUPY, 'export', stazeni.suggestedFilename());
      await fs.mkdir(path.dirname(cil), { recursive: true });
      await stazeni.saveAs(cil);
      data = new Uint8Array(await fs.readFile(cil));
    }
  }
  over(data, 'opravený sken se stáhl');

  console.log('Kontrola opraveného skenu');
  const original = await otevri(new Uint8Array(await fs.readFile(path.join(DATA, 'esd-2-plna-moc-sken.pdf'))));
  const opraveny = await otevri(data!);
  const renderOrig = await vyrenderuj(original, 1);
  const renderOprav = await vyrenderuj(opraveny, 1);
  for (const o of SKRTY) {
    const m = zmerSkrt(renderOprav, o.usek);
    over(m, `${o.popis}: škrt je na místě`);
    const odchylka = Math.max(Math.abs(m!.zacatek), Math.abs(m!.konec - o.usek.delka));
    over(odchylka <= 2, `${o.popis}: škrt sedí na textu skenu (odchylka ${odchylka.toFixed(2)} b)`);
  }
  const nove = await polozky(opraveny, 1);
  for (const text of ['14. 5. 1983', '401243'])
    over(nove.some((p) => p.str.includes(text)), `oprava „${text}" je ve skenu jako text`);
  const puvodniObrazky = (await obrazky(original, 1)).length;
  const noveBoxy = [...nove.map(boxPolozky), ...(await obrazky(opraveny, 1)).slice(puvodniObrazky)];
  for (const box of noveBoxy) {
    const tmave = podilTmavych(renderOrig, box);
    over(tmave < 0.002, `oprava/podpis leží na prázdném místě skenu (tmavé pixely ${(tmave * 100).toFixed(2)} %)`);
  }
  for (let i = 0; i < noveBoxy.length; i++)
    for (let j = i + 1; j < noveBoxy.length; j++) over(!prekryvaSe(noveBoxy[i], noveBoxy[j], 0.2), 'opravy a podpisy se nepřekrývají');
  await original.loadingTask.destroy();
  await opraveny.loadingTask.destroy();

  over(chyby.length === 0, `v konzoli prohlížeče nejsou chyby${chyby.length ? ': ' + chyby.join(' | ') : ''}`);
  console.log('\nKrok 5: vše v pořádku.');
} finally {
  await prohlizec.close();
}
