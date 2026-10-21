/**
 * Test kroku 2 v prohlížeči (testovací režim MOCK_GEMINI=1, MOCK_DISK=1):
 * dohledání s textem intervence, s e-mailem (EML) a s dokumentem Word (DOCX),
 * průběh hledání na Disku, výsledek 5 bodů a chyba 429 s tlačítkem Zkusit znovu.
 *
 * Spuštění (appka musí běžet): npx tsx testy/e2e/krok2-dohledani.ts
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { DATA, hlidejChyby, NOTEBOOK, over, snimek, spustProhlizec, zalozIntervenci } from './prohlizec';

const ESD = ['esd-1-zaznam.pdf', 'esd-2-plna-moc.pdf'];
const TEXT = await fs.readFile(path.join(DATA, 'intervence.txt'), 'utf8');

async function dohledej(stranka: Page) {
  await stranka.getByRole('button', { name: /Spustit dohledání|Dohledat znovu|Zkusit znovu/ }).first().click();
}

async function overVysledek(stranka: Page, popis: string) {
  await stranka.getByText('Nalezeno 5 bodů').waitFor({ timeout: 30_000 });
  over(true, `${popis}: nalezeno 5 bodů`);
  over(await stranka.getByText('→ 14. 5. 1983').count() === 1, `${popis}: datum narození ze smlouvy`);
  over(await stranka.getByText('→ 401243').count() === 1, `${popis}: získatelské číslo z Disku`);
  over(await stranka.getByText('→ Masarykova 123/45, 602 00 Brno').count() === 1, `${popis}: adresa pobočky z Disku`);
  over(await stranka.getByText('Ruční úkol', { exact: true }).count() === 1, `${popis}: jeden ruční úkol`);
}

const prohlizec = await spustProhlizec();
try {
  const stranka = await (await prohlizec.newContext({ viewport: NOTEBOOK })).newPage();
  const chyby = hlidejChyby(stranka);

  console.log('Text intervence');
  await zalozIntervenci(stranka, { esd: ESD, text: TEXT });
  await dohledej(stranka);
  await stranka.getByText('Hledám na Disku: „získatelské číslo"').waitFor();
  over(true, 'průběh hlásí hledání na Disku');
  await stranka.getByText('Čtu soubor z Disku: „Seznam zprostředkovatelů 2026"').waitFor();
  over(true, 'průběh hlásí čtení souboru z Disku');
  await overVysledek(stranka, 'text');
  await snimek(stranka, 'krok2-vysledek');

  console.log('Uložení výsledku');
  await stranka.reload();
  await stranka.getByText('Nalezeno 5 bodů').waitFor();
  over(true, 'výsledek zůstal po obnovení stránky');

  console.log('Intervence jako e-mail (EML)');
  await zalozIntervenci(stranka, { esd: ESD, prilohy: ['intervence.eml'] });
  await dohledej(stranka);
  await overVysledek(stranka, 'EML');

  console.log('Intervence jako Word (DOCX) + sken ESD');
  await zalozIntervenci(stranka, { esd: ['esd-1-zaznam.pdf', 'esd-2-plna-moc-sken.pdf'], prilohy: ['intervence.docx'] });
  await dohledej(stranka);
  await overVysledek(stranka, 'DOCX');

  console.log('Chyba 429 a Zkusit znovu');
  await zalozIntervenci(stranka, { esd: ESD, text: `${TEXT}\n#TEST-429-${Date.now()}` });
  await dohledej(stranka);
  await stranka.getByText('Gemini je teď přetížené').waitFor();
  over(true, 'chyba 429 je česky');
  await snimek(stranka, 'krok2-chyba');
  await stranka.getByRole('button', { name: 'Zkusit znovu' }).click();
  await overVysledek(stranka, 'po opakování');

  over(chyby.length === 0, `v konzoli prohlížeče nejsou chyby${chyby.length ? ': ' + chyby.join(' | ') : ''}`);
  console.log('\nKrok 2: vše v pořádku.');
} finally {
  await prohlizec.close();
}
