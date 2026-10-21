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

/** Notebook 14" ve výchozím zvětšení Windows (1920×1080 při 150 %). */
export const NOTEBOOK = { width: 1280, height: 720 };

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

/** Sleduje chyby v konzoli prohlížeče – test na konci ověří, že žádné nebyly. */
export function hlidejChyby(stranka: Page) {
  const chyby: string[] = [];
  stranka.on('pageerror', (e) => chyby.push(`pageerror: ${e.message}`));
  stranka.on('console', (zprava) => {
    if (zprava.type() === 'error') chyby.push(`console: ${zprava.text()}`);
  });
  return chyby;
}
