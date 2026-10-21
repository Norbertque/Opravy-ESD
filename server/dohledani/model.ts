/**
 * Rozhraní mezi smyčkou dohledání a modelem. Skutečné Gemini (model-gemini.ts)
 * i testovací náhrada (model-mock.ts) ho implementují stejně, takže smyčka
 * nástrojů v dohledej.ts je pro oba úplně stejná.
 */
import type { KodChyby } from '../../src/sdilene/dohledani';
import type { Blok } from './vstupy';

/** Popis vlastního nástroje (funkce) pro model. */
export interface DefiniceNastroje {
  nazev: string;
  popis: string;
  /** JSON schéma parametrů. */
  parametry: Record<string, unknown>;
}

export interface NastrojeProModel {
  funkce: DefiniceNastroje[];
  googleSearch: boolean;
  urlContext: boolean;
}

/** Model chce zavolat náš nástroj. */
export interface VolaniNastroje {
  id: string;
  nazev: string;
  argumenty: Record<string, unknown>;
}

/** Výsledek našeho nástroje, který posíláme modelu zpět. */
export interface VysledekNastroje {
  id: string;
  nazev: string;
  obsah: Blok[];
}

/** Jedna odpověď modelu. */
export interface KrokModelu {
  /** Pro navázání dalšího kroku. */
  id: string;
  /** Nástroje, které máme zavolat (prázdné = model skončil). */
  volani: VolaniNastroje[];
  /** Dotazy, které model sám položil Google vyhledávání (jen pro průběh). */
  hledaniGoogle: string[];
  /** Webové stránky, které model sám četl (jen pro průběh). */
  cteneStranky: string[];
  /** Text odpovědi (u posledního kroku JSON s výsledkem). */
  text: string;
}

export interface Pozadavek {
  nastroje: NastrojeProModel;
  /** Odpověď má být JSON podle schématu výsledku. */
  json: boolean;
  /** Model už nesmí volat nástroje (vyčerpaný limit). */
  bezNastroju?: boolean;
  signal: AbortSignal;
}

export interface ModelKlient {
  readonly nazev: string;
  readonly testovaci: boolean;
  zacni(p: Pozadavek & { system: string; vstup: Blok[] }): Promise<KrokModelu>;
  /** Pokračování: buď výsledky nástrojů, nebo další pokyn textem. */
  pokracuj(p: Pozadavek & { predchozi: string; vysledky?: VysledekNastroje[]; pokyn?: string }): Promise<KrokModelu>;
  /** Nahraje velký soubor do Files API (vrací odkaz pro vstup). */
  nahrajSoubor(data: Buffer, mimeType: string, nazev: string): Promise<{ uri: string; mimeType: string; name: string }>;
  /** Smaže soubor z Files API (po dohledání). */
  smazSoubor(name: string): Promise<void>;
}

/** Chyba modelu srozumitelná pro uživatele. */
export class ChybaModelu extends Error {
  constructor(
    readonly kod: KodChyby,
    zprava: string,
  ) {
    super(zprava);
    this.name = 'ChybaModelu';
  }
}

export const HLASKY = {
  limit: 'Gemini je teď přetížené nebo byl vyčerpán limit dotazů. Počkejte chvíli a zkuste to znovu.',
  timeout: 'Gemini odpovídalo příliš dlouho. Zkuste to znovu.',
  klic: 'Gemini nejde použít: chybí nebo je neplatný klíč (GEMINI_API_KEY). V AI Studiu ho zkontrolujte v Nastavení → Secrets.',
  model: 'Gemini vrátilo odpověď, se kterou appka neumí pracovat. Zkuste to znovu.',
  jina: 'Při dohledání došlo k chybě. Zkuste to znovu.',
} as const;
