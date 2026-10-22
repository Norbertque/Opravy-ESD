/**
 * Test kroku 1 v prohlížeči: nová intervence, nahrání smlouvy, ESD a intervence,
 * kontroly PDF (sken, šifrování, digitální podpis), náhled a obnovení po načtení stránky.
 *
 * Spuštění (appka musí běžet): npx tsx testy/e2e/krok1-nahrani.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { ADRESA, DATA, hlidejChyby, NOTEBOOK, over, snimek, spustProhlizec, VYSTUPY } from './prohlizec';

async function falesnePdf() {
  // Digitálně „podepsané" PDF: podpisové pole s hodnotou a /ByteRange
  const podepsane = await PDFDocument.create();
  const strana = podepsane.addPage([300, 300]);
  const ctx = podepsane.context;
  const podpis = ctx.register(
    ctx.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 0, 0, 0],
      Contents: PDFHexString.of('00'.repeat(64)),
    }),
  );
  const pole = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Podpis1'), V: podpis, Rect: [0, 0, 0, 0], F: 132, P: strana.ref }),
  );
  strana.node.addAnnot(pole);
  podepsane.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [pole], SigFlags: 3 }));
  strana.drawText('Podepsany dokument', { x: 30, y: 150, size: 14 });
  await fs.writeFile(path.join(VYSTUPY, 'podepsane.pdf'), await podepsane.save());

  // Zašifrované PDF (heslo k otevření)
  const sifrovane = await PDFDocument.create();
  sifrovane.addPage([300, 300]).drawText('Tajne', { x: 30, y: 150, size: 14 });
  sifrovane.context.trailerInfo.Encrypt = sifrovane.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    O: PDFHexString.of('11'.repeat(32)),
    U: PDFHexString.of('22'.repeat(32)),
    P: -4,
  });
  await fs.writeFile(path.join(VYSTUPY, 'sifrovane.pdf'), await sifrovane.save());
}

const prohlizec = await spustProhlizec();
try {
  await falesnePdf();
  const stranka = await (await prohlizec.newContext({ viewport: NOTEBOOK })).newPage();
  const chyby = hlidejChyby(stranka);

  console.log('Seznam a nová intervence');
  await stranka.goto(ADRESA);
  await stranka.getByText('Testovací režim').waitFor();
  over(true, 'appka hlásí testovací režim');
  await stranka.getByRole('button', { name: 'Nová intervence' }).click();
  await stranka.waitForURL(/#\/intervence\//);
  over(true, 'nová intervence se otevřela');

  const vstupy = stranka.locator('input[type=file]');
  console.log('Nahrání');
  await vstupy.nth(0).setInputFiles(path.join(DATA, 'smlouva.pdf'));
  await stranka.getByText('3 strany').waitFor();
  over(await stranka.getByLabel('Název intervence').inputValue() === 'smlouva', 'název intervence se vyplnil podle smlouvy');

  await vstupy.nth(1).setInputFiles([
    path.join(DATA, 'esd-1-zaznam.pdf'),
    path.join(DATA, 'esd-2-plna-moc.pdf'),
    path.join(DATA, 'esd-2-plna-moc-sken.pdf'),
  ]);
  await stranka.getByText('Celé PDF je sken bez textu').waitFor();
  over(await stranka.getByText('Kontroluji soubor').count() === 0, 'všechna ESD jsou zkontrolovaná');
  over(await stranka.getByText('Celé PDF je sken bez textu').count() === 1, 'sken se poznal, digitální ESD ne');

  await stranka.getByPlaceholder('Sem vložte text intervence').fill(await fs.readFile(path.join(DATA, 'intervence.txt'), 'utf8'));
  await vstupy.nth(2).setInputFiles(path.join(DATA, 'intervence.eml'));
  await stranka.getByText('intervence.eml').waitFor();
  over(await stranka.getByRole('button', { name: /Pokračovat k dohledání/ }).isEnabled(), 'tlačítko Pokračovat je aktivní');

  console.log('Kontroly PDF');
  await vstupy.nth(1).setInputFiles([path.join(VYSTUPY, 'podepsane.pdf'), path.join(VYSTUPY, 'sifrovane.pdf')]);
  await stranka.getByText('digitálně podepsané').waitFor();
  over(true, 'digitálně podepsané PDF má upozornění');
  await stranka.getByText('zašifrované heslem').waitFor();
  over(true, 'zašifrované PDF má srozumitelnou chybu');
  over(await stranka.getByRole('button', { name: /Pokračovat k dohledání/ }).isDisabled(), 'se zašifrovaným ESD nejde pokračovat');
  await snimek(stranka, 'krok1-nahrani');

  // Odebrat problémové soubory (appka se ptá, jestli opravdu)
  stranka.on('dialog', (d) => void d.accept());
  for (const nazev of ['sifrovane.pdf', 'podepsane.pdf']) {
    await stranka.locator('div.rounded-lg', { hasText: nazev }).last().getByRole('button', { name: 'Odebrat' }).click();
  }
  over(await stranka.getByRole('button', { name: /Pokračovat k dohledání/ }).isEnabled(), 'po odebrání jde pokračovat');

  console.log('Náhled');
  await stranka.locator('div.rounded-lg', { hasText: 'esd-2-plna-moc.pdf' }).first().getByRole('button', { name: 'Náhled' }).click();
  await stranka.getByText('Strana 1 z 2').waitFor();
  await stranka.waitForTimeout(800);
  const vykresleno = await stranka.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let tmavych = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) tmavych++;
    return { sirka: c.width, vyska: c.height, tmavych };
  });
  over(vykresleno.sirka > vykresleno.vyska, 'otočená strana plné moci se zobrazuje na šířku');
  over(vykresleno.tmavych > 500, 'náhled stránky obsahuje vykreslený text');
  await snimek(stranka, 'krok1-nahled');

  console.log('Uložení a obnovení');
  await stranka.waitForTimeout(600);
  await stranka.reload();
  await stranka.getByText('esd-1-zaznam.pdf').waitFor();
  over(await stranka.getByText('intervence.eml').count() === 1, 'po obnovení stránky jsou soubory na místě');
  over(
    (await stranka.getByPlaceholder('Sem vložte text intervence').inputValue()).includes('získatelské číslo'),
    'po obnovení zůstal text intervence',
  );
  await stranka.goto(`${ADRESA}/#/`);
  await stranka.getByText('smlouva', { exact: true }).waitFor();
  over(true, 'intervence je v seznamu');
  await snimek(stranka, 'krok1-seznam');

  over(chyby.length === 0, `v konzoli prohlížeče nejsou chyby${chyby.length ? ': ' + chyby.join(' | ') : ''}`);
  console.log('\nKrok 1: vše v pořádku.');
} finally {
  await prohlizec.close();
}
