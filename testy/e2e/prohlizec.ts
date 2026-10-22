import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';

/**
 * Pomůcky pro testy v prohlížeči (Chromium přes playwright-core).
 * Cesta k Chromiu se dá nastavit proměnnou CHROMIUM_PATH.
 * Appka musí běžet (npm run dev) s MOCK_GEMINI=1 a MOCK_DISK=1.
 */
export const KOREN = path.resolve(import.meta.dirname, '../..');
export const DATA = path.join(KOREN, 'testovaci-data');
export const VYSTUPY = path.join(KOREN, 'test-vystupy');
export const ADRESA = process.env.APP_ADRESA ?? 'http://localhost:3000';

/** Okno prohlížeče na 14" notebooku (1920×1080 při 150 %, bez lišt prohlížeče a Windows). */
export const NOTEBOOK = { width: 1280, height: 600 };

export async function spustProhlizec() {
  await fs.mkdir(VYSTUPY, { recursive: true });
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'],
  });
}

export async function snimek(stranka: Page, nazev: string) {
  await stranka.screenshot({ path: path.join(VYSTUPY, `${nazev}.png`) });
}

/** Jednoduchá kontrola: když podmínka neplatí, test skončí s českou hláškou. */
export function over(podminka: unknown, zprava: string): asserts podminka {
  if (!podminka) throw new Error(`TEST SELHAL: ${zprava}`);
  console.log(`  ✓ ${zprava}`);
}

/** Založí novou intervenci a nahraje soubory z testovaci-data/. Vrací adresu intervence. */
export async function zalozIntervenci(
  stranka: Page,
  moznosti: { esd: string[]; text?: string; prilohy?: string[] },
) {
  await stranka.goto(`${ADRESA}/#/`);
  await stranka.getByRole('button', { name: 'Nová intervence' }).click();
  await stranka.waitForURL(/#\/intervence\//);
  const vstupy = stranka.locator('input[type=file]');
  await vstupy.nth(0).setInputFiles(path.join(DATA, 'smlouva.pdf'));
  await vstupy.nth(1).setInputFiles(moznosti.esd.map((s) => path.join(DATA, s)));
  if (moznosti.text !== undefined) await stranka.getByPlaceholder('Sem vložte text intervence').fill(moznosti.text);
  if (moznosti.prilohy?.length) await vstupy.nth(2).setInputFiles(moznosti.prilohy.map((s) => path.join(DATA, s)));
  const pokracovat = stranka.getByRole('button', { name: /Pokračovat k dohledání/ });
  await stranka.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Pokračovat k dohledání') && !b.disabled),
    undefined,
    { timeout: 30_000 },
  );
  await pokracovat.click();
  return stranka.url();
}

/** Sleduje chyby v konzoli prohlížeče – test na konci ověří, že žádné nebyly. */
export function hlidejChyby(stranka: Page) {
  const chyby: string[] = [];
  stranka.on('pageerror', (e) => chyby.push(`pageerror: ${e.message}`));
  stranka.on('console', (zprava) => {
    if (process.env.LADENI) console.log('[prohlížeč]', zprava.type(), zprava.text());
    if (zprava.type() === 'error') chyby.push(`console: ${zprava.text()}`);
  });
  return chyby;
}
