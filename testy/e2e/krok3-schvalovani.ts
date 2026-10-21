/**
 * Test kroku 3 v prohlížeči (MOCK_GEMINI=1, MOCK_DISK=1): Schválit vše, úprava,
 * zamítnutí, ruční výběr místa nenalezeného textu, ruční oprava tažením obdélníku,
 * odkaz na smlouvu, ruční úkol a uložení po obnovení stránky.
 *
 * Spuštění (appka musí běžet): npx tsx testy/e2e/krok3-schvalovani.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { DATA, hlidejChyby, NOTEBOOK, over, snimek, spustProhlizec, zalozIntervenci } from './prohlizec';

const TEXT = await fs.readFile(path.join(DATA, 'intervence.txt'), 'utf8');

/** Natáhne obdélník přes oblast stránky zadanou v souřadnicích PDF (x0, y0 vlevo dole; x1, y1 vpravo nahoře). */
async function tahni(stranka: Page, cisloStrany: number, view: number[], pdf: [number, number, number, number], otoceni = 0) {
  const ram = (await stranka.locator(`[data-strana="${cisloStrany}"] > div.relative`).first().boundingBox())!;
  const sirkaView = otoceni % 180 === 0 ? view[2] - view[0] : view[3] - view[1];
  const m = ram.width / sirkaView;
  const naObrazovku = (x: number, y: number) =>
    otoceni === 90
      ? { x: ram.x + (y - view[1]) * m, y: ram.y + (x - view[0]) * m }
      : { x: ram.x + (x - view[0]) * m, y: ram.y + (view[3] - y) * m };
  const a = naObrazovku(pdf[0], pdf[3]);
  const b = naObrazovku(pdf[2], pdf[1]);
  await stranka.mouse.move(a.x, a.y);
  await stranka.mouse.down();
  await stranka.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await stranka.mouse.move(b.x, b.y, { steps: 4 });
  await stranka.mouse.up();
}

const karta = (stranka: Page, cislo: number) => stranka.getByRole('article', { name: `Bod ${cislo}` });

const prohlizec = await spustProhlizec();
try {
  const stranka = await (await prohlizec.newContext({ viewport: NOTEBOOK })).newPage();
  const chyby = hlidejChyby(stranka);

  await zalozIntervenci(stranka, { esd: ['esd-1-zaznam.pdf', 'esd-2-plna-moc.pdf'], text: `${TEXT}\n#TEST-NENALEZENO` });
  await stranka.getByRole('button', { name: 'Spustit dohledání' }).click();
  await stranka.getByText('Nalezeno 5 bodů').waitFor({ timeout: 30_000 });
  await stranka.getByRole('button', { name: /Pokračovat ke schvalování/ }).click();

  console.log('Schválit vše');
  await stranka.getByRole('button', { name: 'Schválit vše (3)' }).waitFor({ timeout: 30_000 });
  over(true, 'Schválit vše nabízí 3 body (bod s nenalezeným textem ne)');
  over(await karta(stranka, 3).getByText('Text se v PDF nenašel').count() === 1, 'bod 3 hlásí nenalezený text');
  over(await karta(stranka, 3).getByRole('button', { name: 'Schválit' }).isDisabled(), 'bod 3 nejde schválit bez místa');
  await stranka.getByRole('button', { name: 'Schválit vše (3)' }).click();
  await stranka.getByText('Schváleno 3 z 4 bodů').waitFor();
  over(true, 'po Schválit vše jsou schválené 3 body');

  console.log('Ruční výběr místa');
  await karta(stranka, 3).getByRole('button', { name: 'Vybrat místo' }).click();
  await stranka.getByRole('tab', { name: 'esd-2-plna-moc.pdf' }).and(stranka.locator('[aria-selected="true"]')).waitFor();
  await stranka.getByText('Natáhněte obdélník přes chybný text').waitFor();
  await stranka.waitForTimeout(500);
  // „401234" na otočené straně: účaří x = 160, text od y ≈ 563 do 598
  await tahni(stranka, 1, [0, 0, 595.28, 841.89], [152, 560, 164, 600], 90);
  await karta(stranka, 3).getByRole('button', { name: 'Změnit místo' }).waitFor();
  over(await karta(stranka, 3).getByText('místo vybráno ručně').count() === 0, 'místo je vybrané (bez výzvy)');
  await karta(stranka, 3).getByRole('button', { name: 'Schválit' }).click();
  await stranka.getByText('Schváleno 4 z 4 bodů').waitFor();
  over(true, 'bod 3 jde po výběru místa schválit');

  console.log('Úprava a zamítnutí');
  await karta(stranka, 4).getByRole('button', { name: 'Zrušit schválení' }).click();
  await karta(stranka, 4).getByRole('button', { name: 'Upravit' }).click();
  await karta(stranka, 4).getByLabel('Oprava').fill('Masarykova 123/45, 602 00 Brno-střed');
  await karta(stranka, 4).getByRole('button', { name: 'Uložit' }).click();
  over(await karta(stranka, 4).getByText('→ Masarykova 123/45, 602 00 Brno-střed').count() > 0, 'oprava jde upravit');
  await karta(stranka, 2).getByRole('button', { name: 'Zrušit schválení' }).click();
  await karta(stranka, 2).getByRole('button', { name: 'Zamítnout' }).click();
  over(await karta(stranka, 2).getByText('Zamítnuto').count() === 1, 'bod jde zamítnout');
  await karta(stranka, 4).getByRole('button', { name: 'Schválit' }).click();

  console.log('Ruční oprava');
  await stranka.getByRole('tab', { name: 'esd-1-zaznam.pdf' }).click();
  await stranka.getByRole('button', { name: 'Přidat ruční opravu' }).click();
  await stranka.waitForTimeout(500);
  // telefon „+420 600 000 000": účaří y = 565, x od 196
  await tahni(stranka, 1, [25, 35, 545.28, 776.89], [194, 561, 284, 576]);
  await stranka.getByPlaceholder('Správný text').fill('+420 600 111 222');
  await stranka.getByRole('button', { name: 'Přidat opravu' }).click();
  await stranka.getByText('+420 600 111 222').first().waitFor();
  over(true, 'ruční oprava je v seznamu');

  console.log('Zdroj a ruční úkol');
  await karta(stranka, 1).getByRole('button', { name: /Smlouva, čl. 1, str. 1/ }).click();
  over(await stranka.getByRole('tab', { name: 'Smlouva' }).getAttribute('aria-selected') === 'true', 'odkaz na zdroj otevře smlouvu');
  await stranka.getByRole('checkbox').first().check();
  await snimek(stranka, 'krok3-schvalovani');

  console.log('Uložení');
  await stranka.waitForTimeout(700);
  await stranka.reload();
  await stranka.getByText('Schváleno 3 z 4 bodů').waitFor({ timeout: 30_000 });
  over(true, 'po obnovení stránky zůstalo schválení (3 schválené, 1 zamítnutý)');
  over(await stranka.getByText('+420 600 111 222').count() > 0, 'po obnovení zůstala ruční oprava');
  over(await stranka.getByRole('checkbox').first().isChecked(), 'po obnovení zůstal hotový ruční úkol');
  over(await stranka.getByRole('button', { name: /Pokračovat ke stažení/ }).isEnabled(), 'jde pokračovat ke stažení');

  over(chyby.length === 0, `v konzoli prohlížeče nejsou chyby${chyby.length ? ': ' + chyby.join(' | ') : ''}`);
  console.log('\nKrok 3: vše v pořádku.');
} finally {
  await prohlizec.close();
}
