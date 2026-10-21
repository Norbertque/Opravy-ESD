/**
 * Smyčka dohledání: model dostane smlouvu, ESD a intervenci, volá nástroje
 * (Disk, ARES, Google) a nakonec vrátí body intervence jako JSON.
 *
 * Obsah dokumentů se nikam neukládá ani neloguje.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { konfigurace } from '../../konfigurace';
import { normalizujBody, type VysledekDohledani } from '../../src/sdilene/dohledani';
import { aresHledej } from '../nastroje/ares';
import { ChybaDisku, type DiskKlient } from '../nastroje/disk';
import {
  ChybaModelu,
  HLASKY,
  type DefiniceNastroje,
  type KrokModelu,
  type ModelKlient,
  type NastrojeProModel,
  type VolaniNastroje,
  type VysledekNastroje,
} from './model';
import type { Blok } from './vstupy';

const SOUBOR_PROMPTU = path.resolve(import.meta.dirname, '../../prompts/intervence.md');

export const FUNKCE: Record<'drive_search' | 'drive_read' | 'ares_hledej', DefiniceNastroje> = {
  drive_search: {
    nazev: 'drive_search',
    popis:
      'Fulltextové hledání ve složce s materiály na Google Disku (včetně podsložek). Vrací jen seznam souborů (id, název, typ, odkaz, datum úpravy), ne jejich obsah.',
    parametry: {
      type: 'object',
      properties: { dotaz: { type: 'string', description: 'Krátký dotaz, 2–4 klíčová slova.' } },
      required: ['dotaz'],
    },
  },
  drive_read: {
    nazev: 'drive_read',
    popis:
      'Přečte obsah souboru z Google Disku podle id z drive_search. Google dokument vrátí jako text, tabulku jako CSV, PDF jako dokument.',
    parametry: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id souboru z výsledku drive_search' } },
      required: ['id'],
    },
  },
  ares_hledej: {
    nazev: 'ares_hledej',
    popis:
      'Registr ARES: veřejné údaje o firmě (obchodní jméno, IČO, sídlo, DIČ) podle IČO nebo názvu firmy. Nikdy nehledej fyzické osoby.',
    parametry: {
      type: 'object',
      properties: {
        ico: { type: 'string', description: 'IČO (8 číslic), když je známé.' },
        nazev: { type: 'string', description: 'Název firmy, když IČO není známé.' },
      },
    },
  },
};

export interface ParametryDohledani {
  model: ModelKlient;
  disk: DiskKlient;
  vstup: Blok[];
  nazvyEsd: string[];
  prubeh: (text: string) => void;
  signal: AbortSignal;
}

export async function dohledej(p: ParametryDohledani): Promise<VysledekDohledani> {
  const { model, disk, prubeh, signal } = p;
  const max = konfigurace.gemini.maxVolaniNastroju;
  const dvoukrokove = konfigurace.gemini.rezimNastroju === 'dvoukrokove';
  const system = (await fs.readFile(SOUBOR_PROMPTU, 'utf8')).replaceAll('{{MAX_VOLANI}}', String(max));
  const nastroje: NastrojeProModel = {
    funkce: [FUNKCE.drive_search, FUNKCE.drive_read, ...(konfigurace.internet.ares ? [FUNKCE.ares_hledej] : [])],
    googleSearch: konfigurace.internet.googleSearch,
    urlContext: konfigurace.internet.urlContext,
  };
  const nazvySouboru = new Map<string, string>();
  let pocet = 0;

  const hlasVestavene = (krok: KrokModelu) => {
    for (const dotaz of krok.hledaniGoogle) prubeh(`Hledám na internetu: „${dotaz}"`);
    for (const url of krok.cteneStranky) prubeh(`Čtu webovou stránku: ${url}`);
    pocet += krok.hledaniGoogle.length + krok.cteneStranky.length;
  };

  prubeh('Čtu smlouvu, ESD a intervenci a rozděluji intervenci na body…');
  let krok = await model.zacni({ system, vstup: p.vstup, nastroje, json: !dvoukrokove, signal });
  hlasVestavene(krok);

  // Smyčka nástrojů
  for (let kolo = 0; krok.volani.length > 0; kolo++) {
    if (kolo > max + 3) throw new ChybaModelu('model', HLASKY.model);
    const povolene = krok.volani.slice(0, Math.max(0, max - pocet));
    const nad = krok.volani.slice(povolene.length);
    const vysledky: VysledekNastroje[] = await Promise.all(
      povolene.map((v) => provedNastroj(v, { disk, prubeh, nazvySouboru })),
    );
    pocet += povolene.length;
    for (const v of nad)
      vysledky.push(textovyVysledek(v, 'Limit volání nástrojů je vyčerpaný. Už nehledej a odpověz z toho, co víš.'));
    const vycerpano = pocet >= max;
    if (vycerpano) prubeh('Limit hledání je vyčerpaný – sestavuji výsledek z toho, co se našlo.');
    krok = await model.pokracuj({
      predchozi: krok.id,
      vysledky,
      nastroje,
      json: !dvoukrokove || vycerpano,
      bezNastroju: vycerpano,
      signal,
    });
    hlasVestavene(krok);
    if (vycerpano && krok.volani.length > 0) throw new ChybaModelu('model', HLASKY.model);
  }

  // Dvoukrokový režim: teprve teď si řekneme o JSON.
  if (dvoukrokove && !jeJson(krok.text)) {
    prubeh('Sestavuji výsledek…');
    krok = await model.pokracuj({
      predchozi: krok.id,
      pokyn: 'Teď sestav výsledek všech bodů intervence jako JSON podle zadaného schématu. Nic dalšího nehledej.',
      nastroje,
      json: true,
      bezNastroju: true,
      signal,
    });
  }

  prubeh('Kontroluji výsledek…');
  let data = zkusJson(krok.text);
  if (data === undefined) {
    krok = await model.pokracuj({
      predchozi: krok.id,
      pokyn: 'Tvoje odpověď nebyla platný JSON. Pošli výsledek znovu, tentokrát pouze jako platný JSON podle schématu.',
      nastroje,
      json: true,
      bezNastroju: true,
      signal,
    });
    data = zkusJson(krok.text);
  }
  if (data === undefined) throw new ChybaModelu('model', HLASKY.model);

  let body;
  try {
    body = normalizujBody(data, p.nazvyEsd);
  } catch {
    throw new ChybaModelu('model', HLASKY.model);
  }
  return { body, model: model.nazev, pocetVolaniNastroju: pocet, testovaci: model.testovaci };
}

interface KontextNastroje {
  disk: DiskKlient;
  prubeh: (text: string) => void;
  nazvySouboru: Map<string, string>;
}

async function provedNastroj(v: VolaniNastroje, k: KontextNastroje): Promise<VysledekNastroje> {
  const arg = (nazev: string) => (typeof v.argumenty[nazev] === 'string' ? (v.argumenty[nazev] as string).trim() : '');
  try {
    switch (v.nazev) {
      case 'drive_search': {
        const dotaz = arg('dotaz');
        k.prubeh(`Hledám na Disku: „${dotaz}"`);
        const soubory = await k.disk.hledat(dotaz);
        for (const s of soubory) k.nazvySouboru.set(s.id, s.nazev);
        return textovyVysledek(v, {
          soubory: soubory.map(({ id, nazev, typ, odkaz, upraveno }) => ({ id, nazev, typ, odkaz, upraveno })),
          poznamka: soubory.length === 0 ? 'Nic nenalezeno. Zkus jiná nebo méně slov.' : undefined,
        });
      }
      case 'drive_read': {
        const id = arg('id');
        k.prubeh(`Čtu soubor z Disku: „${k.nazvySouboru.get(id) ?? id}"`);
        const obsah = await k.disk.precist(id);
        const s = obsah.soubor;
        const hlavicka = `Soubor „${s.nazev}" (${s.typ}), odkaz: ${s.odkaz}, upraveno: ${s.upraveno || 'neznámo'}`;
        if (obsah.druh === 'nepodporovano') return textovyVysledek(v, `${hlavicka}\nSoubor nejde přečíst: ${obsah.duvod}`);
        if (obsah.druh === 'text')
          return { id: v.id, nazev: v.nazev, obsah: [{ druh: 'text', text: `${hlavicka}\n\n${obsah.text}${obsah.zkraceno ? '\n\n[Text byl zkrácen.]' : ''}` }] };
        if (obsah.druh === 'pdf')
          return { id: v.id, nazev: v.nazev, obsah: [{ druh: 'text', text: hlavicka }, { druh: 'dokument', mimeType: 'application/pdf', data: obsah.data }] };
        return { id: v.id, nazev: v.nazev, obsah: [{ druh: 'text', text: hlavicka }, { druh: 'obrazek', mimeType: obsah.mimeType, data: obsah.data }] };
      }
      case 'ares_hledej': {
        const ico = arg('ico');
        const nazev = arg('nazev');
        k.prubeh(`Hledám v registru ARES: ${ico ? `IČO ${ico}` : `„${nazev}"`}`);
        return textovyVysledek(v, await aresHledej({ ico, nazev }));
      }
      default:
        return textovyVysledek(v, `Neznámý nástroj ${v.nazev}.`);
    }
  } catch (chyba) {
    // Vypršelé přihlášení k Disku ukončí celé dohledání – bez Disku by výsledek nebyl úplný.
    if (chyba instanceof ChybaDisku && chyba.kod === 'prihlaseni') throw chyba;
    const zprava = chyba instanceof Error ? chyba.message : 'neznámá chyba';
    return textovyVysledek(v, `Nástroj selhal: ${zprava}`);
  }
}

function textovyVysledek(v: VolaniNastroje, obsah: unknown): VysledekNastroje {
  return {
    id: v.id,
    nazev: v.nazev,
    obsah: [{ druh: 'text', text: typeof obsah === 'string' ? obsah : JSON.stringify(obsah) }],
  };
}

function jeJson(text: string) {
  return zkusJson(text) !== undefined;
}

/** JSON z odpovědi modelu (i když ho obalí do ```json … ```). */
function zkusJson(text: string): unknown {
  const ocisteny = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(ocisteny);
  } catch {
    return undefined;
  }
}
